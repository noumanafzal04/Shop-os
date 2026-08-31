import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useMoney, useShopSettings } from "../../shop/hooks/useShop";
import PageMeta from "../../../components/common/PageMeta";
import BackLink from "../../../components/ui/backLink";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Select from "../../../components/form/Select";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useToast } from "../../../components/ui/toast";
import { ApiError } from "../../../common/types/api";
import { useConfirm } from "../../../components/ui/confirm";
import { catalogService } from "../../catalog/services/catalogService";
import type { Product, ModifierGroup, ProductVariant } from "../../catalog/types";
import { usePickableProducts } from "../../catalog/hooks/useCatalog";
import { sizesOf, whyNotSellable } from "../../pos/availability";
import { useTicket, useDineInMutations, useOpenTickets, useServers, useTables } from "../hooks/useDineIn";
import { useMayWorkTable } from "../ownership";
import { dineInService, type TicketItem } from "../services/dineInService";
import { ROW_ACTION, ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";
import { FULL_SCREEN_PAGE } from "../../../layout/fullScreenPage";

const KOT_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" },
  fired: { label: "In kitchen", cls: "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400" },
  served: { label: "Served", cls: "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400" },
};

export default function TabPage() {
  const { id } = useParams<{ id: string }>();
  const money = useMoney();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();

  const ticketQ = useTicket(id);
  const ticket = ticketQ.data;

  // A tab belongs to the waiter serving it. Someone else's is READ-ONLY here:
  // the screen opens so food can be run and questions answered, and every
  // control that would write is gone rather than present and refused.
  const mayWork = useMayWorkTable();
  const mine = mayWork(ticket?.waiter_id);
  const settings = useShopSettings();
  const taxRate = Number(settings.data?.default_tax_rate ?? 0);
  const { addItems, voidItem, fire, settle, move, merge, cancel, assignWaiter } = useDineInMutations(id);

  /**
   * THE WHOLE MENU, not the first fifteen.
   *
   * `catalogService.products({})` sends no `per_page`, and the endpoint's own
   * default is fifteen. So a waiter filtering to "Curries" saw whatever fifteen
   * items came back newest-first across the entire menu, and a kitchen with
   * forty dishes simply could not be ordered from — the category filter and the
   * search box were narrowing a list that had already been cut.
   *
   * A menu is a working surface, like the bay board and unlike a ledger, so it
   * drains its pages rather than growing a pager. `usePickableProducts` is the
   * shared hook that already does exactly this, and reusing it means the two
   * screens cannot drift on how much of the catalogue they can see.
   */
  const products = usePickableProducts(true);
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await catalogService.categories()).data,
    staleTime: 5 * 60_000,
  });

  const [catFilter, setCatFilter] = useState("");
  const [search, setSearch] = useState("");

  // Modifier picker
  const modModal = useModal();
  const [modProduct, setModProduct] = useState<Product | null>(null);
  /** The size the options sheet was opened for — carried into fireAdd. */
  const [modSize, setModSize] = useState<ProductVariant | null>(null);
  /** The dish whose sizes are being asked about. */
  const [sizeFor, setSizeFor] = useState<Product | null>(null);
  const [picked, setPicked] = useState<Record<string, string[]>>({}); // groupId -> optionIds

  // Move / merge — the floor's two structural changes.
  const moveModal = useModal();
  const mergeModal = useModal();
  const [moveTable, setMoveTable] = useState("");
  const [mergeSource, setMergeSource] = useState("");
  const tables = useTables();
  const openTabs = useOpenTickets(mergeModal.isOpen);

  // Hand over — a section changing hands at shift change. The roster is only
  // fetched once the modal is open; a floor screen polling every few seconds
  // has no business pulling it along too.
  const handOverModal = useModal();
  const [handTo, setHandTo] = useState("");
  const servers = useServers(handOverModal.isOpen);

  // Settle — per-line quantity chosen for this payment (0 = skip the line,
  // < line qty = split part of it, = line qty = the whole line).
  const settleModal = useModal();
  const [settleQty, setSettleQty] = useState<Record<string, number>>({});
  const [method, setMethod] = useState("cash");
  // Money the customer adds on top of the bill. Never part of the total — the
  // server keeps it in its own column so it can never read as revenue.
  const [tip, setTip] = useState("");

  const liveItems = useMemo(
    () => (ticket?.items ?? []).filter((i) => !i.voided_at && i.kot_status !== "void"),
    [ticket],
  );
  const unsettled = liveItems.filter((i) => !i.sale_id);
  const firable = unsettled.filter((i) => i.kot_status === "pending");

  const menu = (products.data?.rows ?? []).filter((p) => {
    if (catFilter && p.category_id !== catFilter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  /**
   * Why this dish cannot be ordered, or null — the screen's half of a fence the
   * server has always had.
   *
   * `AddTicketItemsAction` refuses a sold-out dish and an empty shelf, and this
   * tile read neither, so a waiter promised a table something the server was
   * about to refuse and `fireAdd` reported it as "Couldn't add the item."
   *
   * The rule itself is `../../pos/availability`, shared with the till. It was
   * written twice — once here and once there — within twenty minutes of each
   * other, which is precisely how the 86 rule and the discount ceiling came to
   * disagree between these same two screens. There is no offline queue behind a
   * tab (offline refuses dine-in outright), so this reads the catalogue plainly.
   */
  const whyNot = (p: Product, v: ProductVariant | null = null): string | null =>
    whyNotSellable(p, v);

  const addProduct = (p: Product, size: ProductVariant | null = null) => {
    const refused = whyNot(p, size);
    if (refused !== null) {
      toast.error(refused);

      return;
    }

    // Size first, then the extras — a Large Karahi with extra naan is two
    // questions and they have an order.
    if (size === null && sizesOf(p).length > 0) {
      setSizeFor(p);

      return;
    }

    if (p.modifier_groups && p.modifier_groups.length > 0) {
      const seed: Record<string, string[]> = {};
      p.modifier_groups.forEach((g) => {
        seed[g.id ?? g.name] = (g.options ?? []).filter((o) => o.is_default && o.id).map((o) => o.id as string);
      });
      setModSize(size);
      setModProduct(p);
      setPicked(seed);
      modModal.openModal();

      return;
    }
    fireAdd(p.id, [], undefined, size?.id ?? null);
  };

  /**
   * `variant_id` was the one field this never sent.
   *
   * The server has been complete for this the whole time — it validates the
   * variant fenced to the product, prices the line from the variant's own price,
   * snapshots the name onto the tab row, prints "Half"/"Large" on the KOT and
   * the kitchen display, and carries it into the sale on settle. There is even
   * an end-to-end test asserting 800 + 1400 = 2200 through all of it.
   *
   * And this function built `{product_id, quantity, modifier_option_ids, note}`,
   * so every one of those capabilities was unreachable: a Half was rung, cooked
   * and billed as a Full at the parent's price.
   */
  const fireAdd = (
    productId: string,
    modifierOptionIds: string[],
    note?: string,
    variantId: string | null = null,
  ) => {
    if (!id) return;
    addItems.mutate(
      {
        id,
        items: [{
          product_id: productId,
          variant_id: variantId,
          quantity: 1,
          modifier_option_ids: modifierOptionIds,
          note,
        }],
      },
      {
        // The server's own sentence, not a shrug. It refuses for reasons a
        // waiter can act on — sold out, not enough left, a retired size — and
        // "Couldn't add the item." threw every one of them away.
        onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't add the item."),
      },
    );
  };

  const modGroupValid = (g: ModifierGroup) => {
    const n = (picked[g.id ?? g.name] ?? []).length;
    return n >= g.min_select && n <= g.max_select;
  };
  const modValid = modProduct?.modifier_groups?.every(modGroupValid) ?? true;

  const toggleOption = (g: ModifierGroup, optionId: string) => {
    const key = g.id ?? g.name;
    setPicked((prev) => {
      const cur = prev[key] ?? [];
      if (g.max_select === 1) return { ...prev, [key]: [optionId] };
      if (cur.includes(optionId)) return { ...prev, [key]: cur.filter((x) => x !== optionId) };
      if (cur.length >= g.max_select) return prev; // at cap
      return { ...prev, [key]: [...cur, optionId] };
    });
  };

  const confirmModifiers = () => {
    if (!modProduct || !modValid) return;
    const ids = Object.values(picked).flat();
    fireAdd(modProduct.id, ids, undefined, modSize?.id ?? null);
    modModal.closeModal();
    setModSize(null);
  };

  const onVoid = async (item: TicketItem) => {
    const ok = await confirm({ title: "Void this item?", message: item.product_name, confirmLabel: "Void", tone: "danger" });
    if (!ok || !id) return;
    voidItem.mutate({ id, itemId: item.id }, { onError: () => toast.error("Couldn't void the item.") });
  };

  const onFire = () => {
    if (!id || firable.length === 0) return;
    fire.mutate(
      { id }, // no item_ids = fire everything still pending
      {
        onSuccess: (res) => {
          const kots = res.data;
          const label = kots.map((k) => `#${k.kot_number}${k.station ? ` ${k.station}` : ""}`).join(", ");
          toast.success(kots.length === 1 ? `Kitchen ticket ${label} sent` : `${kots.length} kitchen tickets sent (${label})`);

          // Printing IS sending, for a kitchen without a screen: a KOT that
          // never came out of the printer has not reached anyone, whatever the
          // toast says. A shop running the kitchen board instead turns this off.
          if (settings.data?.kot_auto_print !== false) {
            dineInService.printKots(id, kots).catch(() =>
              toast.error("Kitchen ticket didn't print — the board still has it."),
            );
          }
        },
        onError: () => toast.error("Couldn't fire the order."),
      },
    );
  };

  const openSettle = () => {
    // Default: every unsettled line at its full quantity = the whole bill.
    setSettleQty(Object.fromEntries(unsettled.map((i) => [i.id, Number(i.quantity)])));
    setMethod("cash");
    setTip("");
    settle.reset();
    settleModal.openModal();
  };

  // Subtotal of the selected items (pre-tax). Tax is added at settle time by
  // the sale path, so the amount collected must include it. We estimate tax
  // from the shop's default rate (the common case — food usually shares one
  // rate or is tax-free); an over-estimate is safe (it just books change_due),
  // and the printed invoice always carries the exact figure.
  // Each line's contribution = its total prorated to the chosen quantity, so a
  // partial split collects exactly its share (discounts / modifiers included).
  const settleSubtotal = unsettled.reduce((sum, i) => {
    const q = settleQty[i.id] ?? 0;
    const lineQty = Number(i.quantity) || 1;
    return sum + Math.round(((Number(i.line_total) * q) / lineQty) * 100) / 100;
  }, 0);
  const settleTax = Math.round(settleSubtotal * taxRate) / 100;
  const settleBill = Math.round((settleSubtotal + settleTax) * 100) / 100;
  const tipAmount = Math.max(0, Math.round((Number(tip) || 0) * 100) / 100);
  // What the customer hands over: the bill plus whatever they added.
  const settleDue = Math.round((settleBill + tipAmount) * 100) / 100;
  const settleCount = unsettled.filter((i) => (settleQty[i.id] ?? 0) > 0).length;
  const settlingWhole = unsettled.length > 0 && unsettled.every((i) => (settleQty[i.id] ?? 0) >= Number(i.quantity));

  const confirmSettle = () => {
    if (!id || settleCount === 0 || settle.isPending) return;
    // Always send splits (a full-qty split settles the whole line server-side).
    const splits = unsettled
      .filter((i) => (settleQty[i.id] ?? 0) > 0)
      .map((i) => ({ id: i.id, quantity: settleQty[i.id] }));
    settle.mutate(
      {
        id,
        payload: {
          splits,
          payment_method: method,
          amount_paid: settleDue,
          tip_amount: tipAmount || undefined,
        },
      },
      {
        onSuccess: (res) => {
          settleModal.closeModal();
          if (res.data.ticket.status !== "open") {
            toast.success(`Settled — invoice ${res.data.sale.invoice_number}`);
            navigate("/tenant/dine-in");
          } else {
            toast.success("Part of the tab settled");
          }
        },
        onError: () => toast.error("Couldn't settle the tab."),
      },
    );
  };

  const onCancel = async () => {
    const ok = await confirm({
      title: "Cancel this tab?",
      message: "Everything on it will be voided. Nothing paid can be cancelled.",
      confirmLabel: "Cancel tab",
      tone: "danger",
    });
    if (!ok || !id) return;
    cancel.mutate(
      { id },
      {
        onSuccess: () => { toast.success("Tab cancelled"); navigate("/tenant/dine-in"); },
        onError: () => toast.error("Couldn't cancel — part of it may already be paid."),
      },
    );
  };

  if (ticketQ.isLoading || !ticket) {
    return <div className="flex h-dvh items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
    </div>;
  }

  return (
    <div className={`flex ${FULL_SCREEN_PAGE} flex-col bg-gray-50 dark:bg-gray-950`}>
      <PageMeta title={`Tab ${ticket.ticket_number} | CartZe`} description="Dine-in tab" />

      {/* Wraps, for the same reason the floor's header does — and this one
          carries four more controls, so it ran off a phone by more. */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-gray-200 bg-white px-4 py-3 sm:px-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <BackLink to="/tenant/dine-in" label="Floor" />
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-gray-800 sm:text-lg dark:text-white/90">
              {ticket.table?.name ?? "Takeaway"} · {ticket.ticket_number}
            </h1>
            <p className="truncate text-theme-xs text-gray-400">
              {ticket.order_type === "dine_in" ? "Dine-in" : "Takeaway"}
              {ticket.guest_count ? ` · ${ticket.guest_count} guests` : ""}
              {ticket.waiter ? ` · ${ticket.waiter.name}` : ""}
            </p>
          </div>
        </div>
        {mine && (
          <div className="flex flex-wrap items-center gap-1 sm:gap-2">
            {/* A floor moves: a party changes table, and two tables turn out to
                be one party. Both used to mean voiding the tab and re-ringing
                the meal, which loses the KOTs already fired. */}
            <button onClick={() => { setMoveTable(ticket.table?.id ?? ""); moveModal.openModal(); }}
              className={ROW_ACTION}>
              Move table
            </button>
            <button onClick={() => { setMergeSource(""); mergeModal.openModal(); }}
              className={ROW_ACTION}>
              Merge tab
            </button>
            {/* Going off shift with open tabs. Without this the only way to
                pass a table on was a permanent tables.serve_any — the blunt
                instrument that permission exists to avoid. */}
            <button onClick={() => { setHandTo(""); handOverModal.openModal(); }}
              className={ROW_ACTION}>
              Hand over
            </button>
            <button onClick={onCancel} className={ROW_ACTION_DANGER}>Cancel tab</button>
          </div>
        )}
      </header>

      {!mine && (
        <div className="border-b border-warning-200 bg-warning-50 px-5 py-2 text-theme-sm text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-400">
          {ticket.waiter?.name ?? "Another waiter"} is serving this table. You can see the tab but not change it —
          ask them or a supervisor to hand it over.
        </div>
      )}

      {/* TWO SHAPES, BECAUSE A TAB IS WORKED ON TWO KINDS OF SCREEN.
       *
       * This was `w-3/5` / `w-2/5` at every width, with no breakpoint at all —
       * so a waiter on a 390px phone got 234px of menu and 156px of tab, and
       * the tab pane carries a name, a quantity, a KOT badge and a price on
       * every line. The till learned this lesson already (PosPage's three
       * shapes); the tab workspace never had it applied.
       *
       * Below `lg` the two stack and each scrolls on its own, so the menu can
       * use the whole width and the tab is a full-width list underneath rather
       * than a column too narrow to read. `lg` is the tablet-landscape
       * breakpoint in this codebase, which is the smallest screen the side-by-
       * side layout is honest on.
       */}
      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Menu */}
        <div className="flex min-h-0 flex-1 flex-col border-b border-gray-200 lg:w-3/5 lg:flex-none lg:border-b-0 lg:border-r dark:border-gray-800">
          <div className="flex flex-wrap gap-2 border-b border-gray-200 p-3 dark:border-gray-800">
            <Input placeholder="Search menu…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
            <div className="flex flex-wrap gap-1">
              <button onClick={() => setCatFilter("")} className={chip(catFilter === "")}>All</button>
              {(categories.data ?? []).map((c) => (
                <button key={c.id} onClick={() => setCatFilter(c.id)} className={chip(catFilter === c.id)}>{c.name}</button>
              ))}
            </div>
          </div>
          <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.isLoading ? (
              Array.from({ length: 12 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />)
            ) : menu.length === 0 ? (
              <p className="col-span-full py-10 text-center text-sm text-gray-400">No menu items match.</p>
            ) : (
              menu.map((p) => {
                const off = whyNot(p);
                // Sizes are asked for in the sheet, never shown on the tile —
                // see the note on `sizeFor`.
                const asks = sizesOf(p).length > 0;
                return (
                  <button
                    key={p.id}
                      onClick={() => addProduct(p)}
                      disabled={addItems.isPending || !mine || off !== null}
                      /* `min-h-24`, not `h-24`. The fixed height was the only one
                         of the three product grids that physically could not
                         absorb anything new: a chip row underneath it would have
                         been clipped by its own tile. */
                      className="flex min-h-24 w-full flex-col justify-between rounded-xl border border-gray-200 bg-white p-3 text-left transition-colors hover:border-brand-400 disabled:opacity-50 dark:border-gray-800 dark:bg-white/[0.03]"
                    >
                      <span className="line-clamp-2 text-theme-sm font-medium text-gray-800 dark:text-white/90">{p.name}</span>
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-theme-sm font-semibold text-brand-500">
                          {asks ? "from " : ""}{money(p.price)}
                        </span>
                        {/* What the server already refuses, said before a waiter
                            promises it to a table. */}
                        {off !== null && (
                          <span className="text-theme-xs font-semibold uppercase text-error-500">
                            {p.sold_out ? "off" : "none left"}
                          </span>
                        )}
                      </span>
                    </button>
                );
              })
            )}
          </div>
        </div>

        {/* Tab */}
        <div className="flex min-h-0 flex-1 flex-col lg:w-2/5 lg:flex-none">
          <div className="flex-1 overflow-y-auto p-4">
            {liveItems.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-400">Tap menu items to start the tab.</p>
            ) : (
              <div className="space-y-2">
                {liveItems.map((i) => {
                  const badge = KOT_BADGE[i.kot_status] ?? KOT_BADGE.pending;
                  return (
                    <div key={i.id} className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-white/[0.03]">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">
                            {Number(i.quantity)}× {i.product_name}
                            {i.variant_name ? ` (${i.variant_name})` : ""}
                          </p>
                          {i.modifiers && i.modifiers.length > 0 && (
                            <p className="text-theme-xs text-gray-400">{i.modifiers.map((m) => m.name).join(", ")}</p>
                          )}
                          {i.note && <p className="text-theme-xs italic text-gray-400">"{i.note}"</p>}
                          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-theme-xs font-medium ${badge.cls}`}>{badge.label}</span>
                          {i.sale_id && <span className="ml-1 text-theme-xs text-success-600">· paid</span>}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">{money(i.line_total)}</span>
                          {!i.sale_id && mine && (
                            <button onClick={() => onVoid(i)} className="text-theme-xs text-error-500 hover:text-error-600">Void</button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-gray-200 p-4 dark:border-gray-800">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">Running total</span>
              <span className="text-xl font-bold text-gray-800 dark:text-white/90">{money(ticket.running_total)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" onClick={onFire} disabled={firable.length === 0 || fire.isPending || !mine}>
                {fire.isPending ? "Firing…" : `Fire to kitchen${firable.length ? ` (${firable.length})` : ""}`}
              </Button>
              <Button size="sm" onClick={openSettle} disabled={unsettled.length === 0 || !mine}>Settle</Button>
            </div>
          </div>
        </div>
      </div>

      {/* Modifier picker */}
      {/* Which size — for a waiter who taps the dish rather than a size chip.
          The chips on the tile are the fast path; this is the same question in
          the shape the till's rows view uses, so the two screens answer it the
          same way. */}
      <Modal isOpen={sizeFor !== null} onClose={() => setSizeFor(null)} className="max-w-sm p-6">
        {sizeFor && (
          <div>
            <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">{sizeFor.name}</h3>
            <p className="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">Which size?</p>
            <div className="space-y-2">
              {sizesOf(sizeFor).map((v) => {
                const gone = whyNot(sizeFor, v) !== null;
                return (
                  <button
                    key={v.id}
                    type="button"
                    data-tab-size={v.name}
                    disabled={gone}
                    onClick={() => { const dish = sizeFor; setSizeFor(null); addProduct(dish, v); }}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border-2 border-gray-200 px-4 py-3 text-left text-sm font-semibold text-gray-800 transition hover:border-brand-300 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-white/90"
                  >
                    <span>{v.name}</span>
                    <span className="tabular-nums text-brand-600 dark:text-brand-400">{money(Number(v.price))}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={modModal.isOpen} onClose={modModal.closeModal} className="max-w-md p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">{modProduct?.name}</h3>
        <div className="max-h-[50dvh] space-y-4 overflow-y-auto">
          {modProduct?.modifier_groups?.map((g) => {
            const key = g.id ?? g.name;
            const sel = picked[key] ?? [];
            return (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between">
                  <Label>{g.name}</Label>
                  <span className="text-theme-xs text-gray-400">
                    {g.min_select > 0 ? `choose ${g.min_select}` : "optional"}{g.max_select > 1 ? `–${g.max_select}` : ""}
                  </span>
                </div>
                <div className="space-y-1">
                  {(g.options ?? []).map((o) => (
                    <button
                      key={o.id ?? o.name}
                      onClick={() => o.id && toggleOption(g, o.id)}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-theme-sm transition-colors ${
                        o.id && sel.includes(o.id)
                          ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                          : "border-gray-200 text-gray-700 hover:border-gray-300 dark:border-gray-800 dark:text-gray-200"
                      }`}
                    >
                      <span>{o.name}</span>
                      {Number(o.price_delta) > 0 && <span className="text-theme-xs">+{money(o.price_delta)}</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={modModal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={confirmModifiers} disabled={!modValid}>Add to tab</Button>
        </div>
      </Modal>

      {/* Settle */}
      <Modal isOpen={moveModal.isOpen} onClose={moveModal.closeModal} className="max-w-sm p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Move this tab</h3>
        <p className="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">
          Only the seat changes — the order, the kitchen tickets and the bill all stay with the party.
        </p>
        <Label>Table</Label>
        <Select
          value={moveTable}
          options={[
            { value: "", label: "No table (counter / takeaway)" },
            ...(tables.data ?? [])
              .filter((t) => t.id === ticket.table?.id || !t.open_ticket)
              .map((t) => ({ value: t.id, label: t.name })),
          ]}
          onChange={setMoveTable}
        />
        <div className="mt-5 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={moveModal.closeModal}>Cancel</Button>
          <Button size="sm" disabled={move.isPending} onClick={() => {
            if (!id) return;
            move.mutate({ id, dining_table_id: moveTable || null }, {
              onSuccess: () => { moveModal.closeModal(); toast.success("Tab moved"); },
              onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't move the tab."),
            });
          }}>
            {move.isPending ? "Moving…" : "Move"}
          </Button>
        </div>
      </Modal>

      <Modal isOpen={handOverModal.isOpen} onClose={handOverModal.closeModal} className="max-w-sm p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Hand this table over</h3>
        <p className="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">
          The tab, its kitchen tickets and the bill all stay exactly as they are. Only who is
          serving it changes — and from then on it is theirs, not yours.
        </p>
        <Label>Hand to</Label>
        <Select
          value={handTo}
          options={[
            { value: "", label: servers.isPending ? "Loading…" : "Choose a colleague" },
            ...(servers.data ?? [])
              // Handing a table to whoever already holds it is a no-op that
              // reads like a mistake.
              .filter((s) => s.id !== ticket.waiter_id)
              .map((s) => ({ value: s.id, label: s.name })),
          ]}
          onChange={setHandTo}
        />
        <div className="mt-5 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={handOverModal.closeModal}>Cancel</Button>
          <Button size="sm" disabled={!handTo || assignWaiter.isPending} onClick={() => {
            if (!id || !handTo) return;
            assignWaiter.mutate({ id, waiterId: handTo }, {
              onSuccess: () => {
                handOverModal.closeModal();
                toast.success("Table handed over");
              },
              onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't hand the table over."),
            });
          }}>
            {assignWaiter.isPending ? "Handing over…" : "Hand over"}
          </Button>
        </div>
      </Modal>

      <Modal isOpen={mergeModal.isOpen} onClose={mergeModal.closeModal} className="max-w-sm p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Merge another tab into this one</h3>
        <p className="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">
          Its items and kitchen tickets come across, and it closes with a note pointing here. A part-paid tab can't
          be merged.
        </p>
        <Label>Tab to fold in</Label>
        <Select
          value={mergeSource}
          options={[
            { value: "", label: "— Choose a tab —" },
            // Only tabs you may work. Folding another waiter's table into
            // yours moves their takings onto your name, so the server refuses
            // it — offering it here would only produce a refusal.
            ...(openTabs.data ?? [])
              .filter((t) => t.id !== id && mayWork(t.waiter_id))
              .map((t) => ({ value: t.id, label: `${t.table?.name ?? "Takeaway"} · ${t.ticket_number}` })),
          ]}
          onChange={setMergeSource}
        />
        <div className="mt-5 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={mergeModal.closeModal}>Cancel</Button>
          <Button size="sm" disabled={!mergeSource || merge.isPending} onClick={() => {
            if (!id || !mergeSource) return;
            merge.mutate({ id, sourceId: mergeSource }, {
              onSuccess: () => { mergeModal.closeModal(); toast.success("Tabs merged"); },
              onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't merge those tabs."),
            });
          }}>
            {merge.isPending ? "Merging…" : "Merge"}
          </Button>
        </div>
      </Modal>

      <Modal isOpen={settleModal.isOpen} onClose={settleModal.closeModal} className="max-w-md p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Settle tab</h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Choose how many of each item to settle — leave every line at its full count for the whole tab, or lower one to split part of it.
        </p>
        <div className="mb-4 max-h-[40dvh] space-y-1 overflow-y-auto">
          {unsettled.map((i) => {
            const lineQty = Number(i.quantity);
            const q = settleQty[i.id] ?? 0;
            const setQ = (next: number) =>
              setSettleQty((prev) => ({ ...prev, [i.id]: Math.max(0, Math.min(lineQty, next)) }));
            return (
              <div key={i.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-800">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-theme-sm text-gray-700 dark:text-gray-200">{i.product_name}</p>
                  <p className="text-theme-xs text-gray-400">{lineQty}× · {money(i.line_total)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setQ(q - 1)}
                    disabled={q <= 0}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                    aria-label={`Settle less ${i.product_name}`}
                  >−</button>
                  <span className="w-7 text-center text-theme-sm tabular-nums text-gray-800 dark:text-white/90">{q}</span>
                  <button
                    type="button"
                    onClick={() => setQ(q + 1)}
                    disabled={q >= lineQty}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                    aria-label={`Settle more ${i.product_name}`}
                  >+</button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mb-4">
          <Label>Payment</Label>
          <Select
            options={[
              { value: "cash", label: "Cash" },
              { value: "card", label: "Card" },
              { value: "bank_transfer", label: "Bank transfer" },
            ]}
            value={method}
            onChange={setMethod}
          />
        </div>
        <div className="mb-4 space-y-1 rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-800/50">
          <div className="flex items-center justify-between text-theme-sm text-gray-500 dark:text-gray-400">
            <span>{settlingWhole ? "Whole bill" : `${settleCount} item(s)`}</span>
            <span>{money(settleSubtotal)}</span>
          </div>
          {settleTax > 0 && (
            <div className="flex items-center justify-between text-theme-sm text-gray-500 dark:text-gray-400">
              <span>Tax ({taxRate}%)</span>
              <span>{money(settleTax)}</span>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-gray-200 pt-1 dark:border-gray-700">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Bill</span>
            <span className="text-lg font-bold text-gray-800 dark:text-white/90">{money(settleBill)}</span>
          </div>
          {tipAmount > 0 && (
            <div className="flex items-center justify-between text-theme-sm">
              <span className="text-gray-500 dark:text-gray-400">Tip</span>
              <span className="font-medium text-gray-700 dark:text-gray-200">{money(tipAmount)}</span>
            </div>
          )}
          {tipAmount > 0 && (
            <div className="flex items-center justify-between border-t border-gray-200 pt-1 dark:border-gray-700">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">To collect</span>
              <span className="text-lg font-bold text-gray-800 dark:text-white/90">{money(settleDue)}</span>
            </div>
          )}
        </div>

        {/* Tipping is not universal here, so the prompt only appears for a shop
            that asked for it — an extra field on every bill slows the floor. */}
        {settings.data?.tips_enabled && (
          <div className="mb-4">
            <Label>Tip <span className="font-normal text-gray-400">(on top of the bill)</span></Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="number"
                min="0"
                value={tip}
                onChange={(e) => setTip(e.target.value)}
                placeholder="0"
                className="max-w-[8rem]"
              />
              {[5, 10, 15].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setTip(String(Math.round(settleBill * pct) / 100))}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-theme-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                >
                  {pct}%
                </button>
              ))}
              {tipAmount > 0 && (
                <button type="button" onClick={() => setTip("")} className="text-theme-xs font-medium text-error-500 hover:text-error-600">
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={settleModal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={confirmSettle} disabled={settleCount === 0 || settle.isPending}>
            {settle.isPending ? "Settling…" : `Take ${money(settleDue)}`}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function chip(active: boolean) {
  return `rounded-full px-3 py-1 text-theme-xs font-medium transition-colors ${
    active ? "bg-brand-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"
  }`;
}
