import { useEffect, useMemo, useState } from "react";
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
import { useTicket, useDineInMutations, useOpenTickets, useServers, useTables, useTabLines } from "../hooks/useDineIn";
import { useMayWorkTable } from "../ownership";
import { dineInService, type TicketItem } from "../services/dineInService";
import { QUICK_NOTES, isLive, lineExtras, lineName, lineSpoken, piles, portions, totalOf, unsentByDish } from "../tabLines";
import { sinceLabel } from "../floorState";
import { FULL_SCREEN_PAGE } from "../../../layout/fullScreenPage";
import { ListEmpty } from "../../../common/ui/ListEmpty";

/**
 * A control in the tab's header. A real button — bordered, a finger tall.
 *
 * These were four runs of bare text ("Move table", "Merge tab", "Hand over",
 * "Cancel tab") in the type size of a table's row actions, which is what the
 * class they borrowed was written for. On the screen a waiter holds in one
 * hand they were the smallest things on it.
 */
const HEAD_ACTION =
  "inline-flex min-h-11 items-center rounded-xl px-3.5 text-theme-sm font-semibold text-gray-700 ring-1 ring-inset ring-gray-200 transition hover:bg-gray-50 dark:text-gray-200 dark:ring-gray-700 dark:hover:bg-white/5";
const HEAD_ACTION_DANGER =
  "inline-flex min-h-11 items-center rounded-xl px-3.5 text-theme-sm font-semibold text-error-600 ring-1 ring-inset ring-error-200 transition hover:bg-error-50 dark:text-error-400 dark:ring-error-500/40 dark:hover:bg-error-500/10";

/** A round control on an order line: a finger wide, and it says what it does. */
const STEP =
  "flex size-10 shrink-0 items-center justify-center rounded-xl text-xl font-bold leading-none transition disabled:opacity-40";

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
  const { voidItem, fire, settle, move, merge, cancel, assignWaiter } = useDineInMutations(id);
  const lines = useTabLines(id);

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
  /**
   * A SECOND TENDER. "Two thousand cash and the rest on card" is the commonest
   * thing a table of six says, and the settle screen could only take one
   * method — while the endpoint has accepted a `payments[]` array all along.
   * Empty means a single tender, which is most bills and stays one press.
   */
  const [splitMethod, setSplitMethod] = useState("");
  const [splitAmount, setSplitAmount] = useState("");
  // Money the customer adds on top of the bill. Never part of the total — the
  // server keeps it in its own column so it can never read as revenue.
  const [tip, setTip] = useState("");

  const liveItems = useMemo(() => (ticket?.items ?? []).filter(isLive), [ticket]);
  const unsettled = liveItems.filter((i) => !i.sale_id);
  const pile = useMemo(() => piles(ticket?.items ?? []), [ticket]);
  const firable = pile.toSend;
  // What a menu tile counts: what the server holds unsent, plus the taps on
  // that dish still on their way there — so the number moves under the finger.
  const unsent = useMemo(() => unsentByDish(ticket?.items ?? []), [ticket]);
  const onTile = (productId: string) => (unsent[productId] ?? 0) + (lines.waiting[productId] ?? 0);

  // A NOTE FOR THE KITCHEN. The column has been on the line since the first
  // day, and no screen ever wrote to it.
  const noteModal = useModal();
  const [noteFor, setNoteFor] = useState<TicketItem | null>(null);
  const [noteText, setNoteText] = useState("");

  // Below `md` the menu and the order take turns: there is no room for both.
  const [pane, setPane] = useState<"menu" | "order">("menu");
  // …and the header's four controls fold into one sheet.
  const moreModal = useModal();

  // "42m" on the header has to move on a tab nobody is touching.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const allDishes = products.data?.rows ?? [];
  const menu = allDishes.filter((p) => {
    if (catFilter && p.category_id !== catFilter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  // ONLY SECTIONS WITH SOMETHING IN THEM. Every category in the shop was a
  // chip, including the ones with no dish — a new restaurant's "Starters",
  // "Main Course" and "Deals" each filtered the menu to nothing.
  const sections = (categories.data ?? []).filter((c) => allDishes.some((p) => p.category_id === c.id));

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
    lines
      .add({
        product_id: productId,
        variant_id: variantId,
        quantity: 1,
        modifier_option_ids: modifierOptionIds,
        note,
      })
      // The server's own sentence, not a shrug. It refuses for reasons a
      // waiter can act on — sold out, not enough left, a retired size — and
      // "Couldn't add the item." threw every one of them away.
      .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't add the item."));
  };

  /** One more, or one fewer, of a line not yet sent. Down to nothing removes it. */
  const stepLine = (item: TicketItem, by: number) => {
    lines.step(item, by).catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't change that line."));
  };

  const openNote = (item: TicketItem) => {
    setNoteFor(item);
    setNoteText(item.note ?? "");
    noteModal.openModal();
  };

  const saveNote = () => {
    if (!noteFor) return;
    lines
      .note(noteFor, noteText.trim())
      .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't save the note."));
    noteModal.closeModal();
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
    const ok = await confirm({ title: "Void this item?", message: lineSpoken(item), confirmLabel: "Void", tone: "danger" });
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
          // On a phone the waiter was looking at the order to send it; the
          // next thing they do is take the next thing the table says.
          setPane("menu");

          // Printing IS sending, for a kitchen without a screen: a KOT that
          // never came out of the printer has not reached anyone, whatever the
          // toast says. A shop running the kitchen board instead turns this off.
          if (settings.data?.kot_auto_print !== false) {
            dineInService.printKots(id, kots).catch(() =>
              toast.error("Kitchen ticket didn't print — the board still has it."),
            );
          }
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't send the order."),
      },
    );
  };

  /**
   * "Bill please." Printed from the server's figures, not this screen's: the
   * total above is the subtotal with an ESTIMATE of the tax ("+ tax at the
   * bill"), and a slip a customer counts money out against cannot be one.
   */
  const [printingBill, setPrintingBill] = useState(false);
  const onPrintBill = async () => {
    if (!id || printingBill) return;
    setPrintingBill(true);
    try {
      await dineInService.printBill(id);
    } catch (e) {
      // In the server's words when it refused — "Nothing on this tab is
      // waiting to be paid" is more use than "didn't print".
      toast.error(e instanceof ApiError ? e.message : "The bill didn't print — try again.");
    } finally {
      // In `finally`, so a failed print does not leave the button dead.
      setPrintingBill(false);
    }
  };

  const openSettle = () => {
    // Default: every unsettled line at its full quantity = the whole bill.
    setSettleQty(Object.fromEntries(unsettled.map((i) => [i.id, Number(i.quantity)])));
    setMethod("cash");
    setTip("");
    setSplitMethod("");
    setSplitAmount("");
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

  /** The second tender's amount, never more than what is owed. */
  const splitPaid = splitMethod === ""
    ? 0
    : Math.min(settleDue, Math.max(0, Math.round((Number(splitAmount) || 0) * 100) / 100));
  const firstPaid = Math.round((settleDue - splitPaid) * 100) / 100;
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
          // One tender stays one field; two go as the array the endpoint has
          // always taken, so a half-cash-half-card bill is one settle and not
          // two.
          ...(splitPaid > 0
            ? {
                payments: [
                  { method, amount: firstPaid },
                  { method: splitMethod, amount: splitPaid },
                ],
              }
            : { payment_method: method, amount_paid: settleDue }),
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
        /**
         * SAY WHY. This threw the server's reason away and showed one fixed
         * sentence — on the single screen where a refusal is most likely to be
         * about money or stock, and most expensive to guess at. `move` and the
         * waiter handover in this same file already surfaced it.
         */
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't settle the tab."),
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

  const takeaway = ticket.order_type !== "dine_in";
  const since = sinceLabel(ticket.opened_at, now);
  const toSendCount = portions(firable);
  const paidTotal = totalOf(pile.paid);
  const toPay = totalOf(unsettled);

  /** A line the kitchen has, or had. It is what happened: it can be voided, not changed. */
  const sentLine = (i: TicketItem, tone: "kitchen" | "out" | "paid") => (
    <li key={i.id} className="flex items-start gap-3 px-3 py-2.5">
      <span
        className={`flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg px-1.5 text-theme-sm font-bold tabular-nums ${
          tone === "kitchen"
            ? "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300"
            : tone === "out"
              ? "bg-success-100 text-success-700 dark:bg-success-500/20 dark:text-success-300"
              : "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400"
        }`}
      >
        {Number(i.quantity)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-theme-sm font-semibold leading-snug text-gray-900 dark:text-white/90">
          {i.product_name}
          {i.variant_name ? ` (${i.variant_name})` : ""}
        </p>
        {i.modifiers && i.modifiers.length > 0 && (
          <p className="text-theme-xs text-gray-500 dark:text-gray-400">{i.modifiers.map((m) => m.name).join(" · ")}</p>
        )}
        {i.note && (
          <p className="mt-0.5 text-theme-xs font-bold uppercase text-error-600 dark:text-error-400">{i.note}</p>
        )}
        {i.kot_status === "cleared" && (
          <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">Cleared off the kitchen board</p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-theme-sm font-semibold tabular-nums text-gray-900 dark:text-white/90">{money(i.line_total)}</span>
        {tone !== "paid" && mine && (
          <button
            type="button"
            onClick={() => onVoid(i)}
            aria-label={`Void ${lineSpoken(i)}`}
            className="inline-flex min-h-8 items-center rounded-lg px-2 text-theme-xs font-semibold text-error-600 hover:bg-error-50 dark:text-error-400 dark:hover:bg-error-500/10"
          >
            Void
          </button>
        )}
      </div>
    </li>
  );

  const pileHead = (title: string, count: number, cls: string) => (
    <h3 className={`flex items-center justify-between rounded-t-xl px-3 py-2 text-theme-xs font-bold uppercase tracking-wide ${cls}`}>
      {title}
      <span className="tabular-nums">{count}</span>
    </h3>
  );

  return (
    <div className={`flex ${FULL_SCREEN_PAGE} flex-col bg-gray-100 dark:bg-gray-950`}>
      <PageMeta title={`Tab ${ticket.ticket_number}`} description="Dine-in tab" />

      {/* Wraps, for the same reason the floor's header does — and this one
          carries four more controls, so it ran off a phone by more. */}
      <header className="shrink-0 border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <BackLink to="/tenant/dine-in" label="Floor" />
            <div className="min-w-0">
              {/* The table is how a waiter finds the tab, so it is the heading.
                  The tab's number is a reference and goes with the references. */}
              <h1 className="truncate text-xl font-bold leading-tight text-gray-900 dark:text-white">
                {ticket.table?.name ?? ticket.customer_name?.trim() ?? "Takeaway"}
              </h1>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
                <span
                  className={`rounded-md px-1.5 py-0.5 font-semibold ${
                    takeaway
                      ? "bg-theme-purple-500/10 text-theme-purple-500"
                      : "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300"
                  }`}
                >
                  {takeaway ? "Takeaway" : "Dine-in"}
                </span>
                <span>{ticket.ticket_number}</span>
                {ticket.guest_count ? <span>{ticket.guest_count} guests</span> : null}
                {since ? <span>{since}</span> : null}
                {ticket.waiter ? <span>{ticket.waiter.name}</span> : null}
              </p>
            </div>
          </div>
          {/* ON A PHONE, ONE BUTTON. Four of them wrapped onto two rows and
              took a fifth of the screen before a single dish was on it — for
              things done to a tab perhaps once in an evening. */}
          {mine && (
            <button type="button" onClick={moreModal.openModal} className={`${HEAD_ACTION} sm:hidden`} aria-label="More for this tab">
              More
            </button>
          )}
          {mine && (
            <div className="hidden flex-wrap items-center gap-2 sm:flex">
              {/* A floor moves: a party changes table, and two tables turn out to
                  be one party. Both used to mean voiding the tab and re-ringing
                  the meal, which loses the KOTs already fired. */}
              <button type="button" onClick={() => { setMoveTable(ticket.table?.id ?? ""); moveModal.openModal(); }} className={HEAD_ACTION}>
                Move table
              </button>
              <button type="button" onClick={() => { setMergeSource(""); mergeModal.openModal(); }} className={HEAD_ACTION}>
                Merge tab
              </button>
              {/* Going off shift with open tabs. Without this the only way to
                  pass a table on was a permanent tables.serve_any — the blunt
                  instrument that permission exists to avoid. */}
              <button type="button" onClick={() => { setHandTo(""); handOverModal.openModal(); }} className={HEAD_ACTION}>
                Hand over
              </button>
              <button type="button" onClick={onCancel} className={HEAD_ACTION_DANGER}>Cancel tab</button>
            </div>
          )}
        </div>

        {/* On a phone the menu and the order take turns. Each tab says how
            much is behind it, so nobody has to switch to find out. */}
        <div role="tablist" aria-label="Show" className="flex gap-1 px-2 md:hidden">
          {([["menu", "Menu", null], ["order", "Order", liveItems.length]] as const).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={pane === key}
              aria-label={
                count === null || count === 0
                  ? label
                  : toSendCount > 0 ? `${label}, ${toSendCount} to send` : `${label}, ${count} on the tab`
              }
              onClick={() => setPane(key)}
              className={`flex min-h-11 flex-1 items-center justify-center gap-2 border-b-[3px] text-theme-sm font-bold transition ${
                pane === key
                  ? "border-brand-500 text-brand-600 dark:text-brand-400"
                  : "border-transparent text-gray-500 dark:text-gray-400"
              }`}
            >
              {label}
              {count !== null && count > 0 && (
                <span
                  className={`rounded-md px-1.5 text-theme-xs tabular-nums ${
                    toSendCount > 0 ? "bg-warning-500 text-gray-900" : "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300"
                  }`}
                >
                  {toSendCount > 0 ? `${toSendCount} to send` : count}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      {!mine && (
        <div className="shrink-0 border-b border-warning-200 bg-warning-50 px-5 py-2 text-theme-sm text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-400">
          {ticket.waiter?.name ?? "Another waiter"} is serving this table. You can see the tab but not change it —
          ask them or a supervisor to hand it over.
        </div>
      )}

      {/* SIDE BY SIDE FROM A TABLET UP, AND ONE AT A TIME ON A PHONE.
       *
       * This was `w-3/5` / `w-2/5` at every width — 234px of menu beside 156px
       * of tab on a phone — and then stacked below `lg`, which on a tablet
       * held upright put the order underneath the menu and out of sight while
       * it was being taken. A tablet is where this screen is used, in either
       * hand, so the two panes sit beside each other from `md`: the order
       * keeps a fixed, readable width and the menu takes everything else.
       */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Menu */}
        {/* `min-w-0`, and it is load-bearing. A flex child will not shrink
            below its content, and this one's content includes a row of
            section chips that does not wrap — so without it the pane pushed
            the order thirteen pixels off the side of a tablet, total and all. */}
        <div className={`min-h-0 min-w-0 flex-1 flex-col md:flex ${pane === "menu" ? "flex" : "hidden"}`}>
          <div className="shrink-0 space-y-2 border-b border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <Input
              placeholder="Search menu…"
              aria-label="Search menu"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {/* ONE ROW that slides, not a paragraph that wraps. Twelve
                sections wrapped onto three lines and took a row of dishes off
                the screen to do it. */}
            {sections.length > 0 && (
              <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3" role="group" aria-label="Section">
                <button type="button" onClick={() => setCatFilter("")} aria-pressed={catFilter === ""} className={chip(catFilter === "")}>All</button>
                {sections.map((c) => (
                  <button key={c.id} type="button" onClick={() => setCatFilter(c.id)} aria-pressed={catFilter === c.id} className={chip(catFilter === c.id)}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2.5 overflow-y-auto p-3 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {products.isLoading ? (
              Array.from({ length: 12 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />)
            ) : menu.length === 0 ? (
              <ListEmpty from={products} what="the menu">
                <p className="col-span-full py-10 text-center text-sm text-gray-500 dark:text-gray-400">No menu items match.</p>
              </ListEmpty>
            ) : (
              menu.map((p) => {
                const off = whyNot(p);
                // Sizes are asked for in the sheet, never shown on the tile —
                // see the note on `sizeFor`.
                const asks = sizesOf(p).length > 0;
                const count = onTile(p.id);

                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addProduct(p)}
                    /* NOT disabled while a request is in the air. Taps queue
                       (useTabLines); a menu that greyed out for every round
                       trip dropped the taps that landed while it was grey. */
                    disabled={!mine || off !== null}
                    /* `min-h-24`, not `h-24`: a tile has to be able to grow
                       for a long name rather than clip it. */
                    className={`relative flex min-h-24 w-full flex-col justify-between rounded-2xl border-2 p-3 text-left transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 ${
                      count > 0
                        ? "border-brand-500 bg-brand-50 dark:bg-brand-500/15"
                        : "border-gray-200 bg-white hover:border-brand-300 dark:border-gray-800 dark:bg-gray-900"
                    }`}
                  >
                    {/* How many of this are waiting to be sent — on the tile
                        the finger is already on. */}
                    {count > 0 && (
                      <span
                        data-testid="tile-count"
                        className="absolute -right-1.5 -top-1.5 flex h-7 min-w-7 items-center justify-center rounded-full bg-brand-500 px-1.5 text-theme-sm font-bold tabular-nums text-white ring-2 ring-white dark:ring-gray-950"
                      >
                        {count}
                      </span>
                    )}
                    <span className="line-clamp-2 pr-3 text-[15px] font-semibold leading-snug text-gray-900 dark:text-white/90">{p.name}</span>
                    <span className="mt-2 flex items-baseline justify-between gap-2">
                      <span className="text-theme-sm font-bold tabular-nums text-brand-600 dark:text-brand-400">
                        {asks ? "from " : ""}{money(p.price)}
                      </span>
                      {/* What the server already refuses, said before a waiter
                          promises it to a table. */}
                      {off !== null && (
                        <span className="rounded-md bg-error-50 px-1.5 py-0.5 text-theme-xs font-bold uppercase text-error-600 dark:bg-error-500/15 dark:text-error-400">
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

        {/* The order */}
        <div
          className={`min-h-0 min-w-0 flex-1 flex-col border-gray-200 bg-white md:flex md:w-[330px] md:flex-none md:border-l lg:w-[370px] xl:w-[410px] dark:border-gray-800 dark:bg-gray-900 ${
            pane === "order" ? "flex" : "hidden"
          }`}
        >
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {liveItems.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="text-base font-semibold text-gray-700 dark:text-gray-200">Nothing ordered yet</p>
                <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
                  Tap a dish to put it on the tab. Tap it again for one more.
                </p>
              </div>
            ) : (
              <>
                {/* NOT SENT YET — the only lines that can still change, so
                    they are the only ones with controls on them. */}
                {firable.length > 0 && (
                  <section aria-label="Not sent yet" className="rounded-xl border-2 border-warning-300 dark:border-warning-500/50">
                    {pileHead("Not sent yet", toSendCount, "bg-warning-100 text-warning-800 dark:bg-warning-500/20 dark:text-warning-300")}
                    <ul className="divide-y divide-warning-100 dark:divide-warning-500/20">
                      {firable.map((i) => (
                        <li key={i.id} className="px-3 py-2.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-theme-sm font-semibold leading-snug text-gray-900 dark:text-white/90">
                                {i.product_name}
                                {i.variant_name ? ` (${i.variant_name})` : ""}
                              </p>
                              {i.modifiers && i.modifiers.length > 0 && (
                                <p className="text-theme-xs text-gray-500 dark:text-gray-400">{i.modifiers.map((m) => m.name).join(" · ")}</p>
                              )}
                            </div>
                            <span className="shrink-0 text-theme-sm font-semibold tabular-nums text-gray-900 dark:text-white/90">{money(i.line_total)}</span>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            {mine ? (
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => stepLine(i, -1)}
                                  aria-label={Number(i.quantity) <= 1 ? `Remove ${lineSpoken(i)}` : `One fewer ${lineSpoken(i)}`}
                                  className={`${STEP} ${
                                    Number(i.quantity) <= 1
                                      ? "bg-error-50 text-error-600 hover:bg-error-100 dark:bg-error-500/15 dark:text-error-400"
                                      : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-white/10 dark:text-gray-200"
                                  }`}
                                >
                                  {Number(i.quantity) <= 1 ? "×" : "−"}
                                </button>
                                <span className="min-w-8 text-center text-lg font-bold tabular-nums text-gray-900 dark:text-white" aria-label={`${Number(i.quantity)} of ${lineSpoken(i)}`}>
                                  {Number(i.quantity)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => stepLine(i, 1)}
                                  aria-label={`One more ${lineSpoken(i)}`}
                                  className={`${STEP} bg-brand-500 text-white hover:bg-brand-600`}
                                >
                                  +
                                </button>
                              </div>
                            ) : (
                              <span className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{Number(i.quantity)}×</span>
                            )}
                            {/* The note IS the control: said, it reads as the
                                instruction it is, and a press changes it. */}
                            {mine ? (
                              <button
                                type="button"
                                onClick={() => openNote(i)}
                                className={`inline-flex min-h-10 max-w-[60%] items-center rounded-xl px-3 text-theme-xs font-bold ${
                                  i.note
                                    ? "bg-error-50 uppercase text-error-600 dark:bg-error-500/15 dark:text-error-400"
                                    : "text-brand-600 ring-1 ring-inset ring-brand-200 hover:bg-brand-50 dark:text-brand-300 dark:ring-brand-500/40 dark:hover:bg-brand-500/10"
                                }`}
                              >
                                <span className="truncate">{i.note || "+ Kitchen note"}</span>
                              </button>
                            ) : (
                              i.note && <span className="truncate text-theme-xs font-bold uppercase text-error-600 dark:text-error-400">{i.note}</span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {pile.inKitchen.length > 0 && (
                  <section aria-label="In the kitchen" className="rounded-xl border border-orange-200 dark:border-orange-500/30">
                    {pileHead("In the kitchen", portions(pile.inKitchen), "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300")}
                    <ul className="divide-y divide-gray-100 dark:divide-gray-800">{pile.inKitchen.map((i) => sentLine(i, "kitchen"))}</ul>
                  </section>
                )}

                {pile.out.length > 0 && (
                  <section aria-label="Served" className="rounded-xl border border-success-200 dark:border-success-500/30">
                    {pileHead("Served", portions(pile.out), "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400")}
                    <ul className="divide-y divide-gray-100 dark:divide-gray-800">{pile.out.map((i) => sentLine(i, "out"))}</ul>
                  </section>
                )}

                {pile.paid.length > 0 && (
                  <section aria-label="Paid" className="rounded-xl border border-gray-200 dark:border-gray-800">
                    {pileHead("Paid", portions(pile.paid), "bg-gray-50 text-gray-600 dark:bg-white/5 dark:text-gray-300")}
                    <ul className="divide-y divide-gray-100 opacity-70 dark:divide-gray-800">{pile.paid.map((i) => sentLine(i, "paid"))}</ul>
                  </section>
                )}
              </>
            )}
          </div>

          <div className="shrink-0 space-y-3 border-t border-gray-200 p-3 dark:border-gray-800">
            <dl className="space-y-0.5">
              {/* Once part of it is paid, the number a waiter needs is what
                  is LEFT — the same figure the floor's tile shows. */}
              {paidTotal > 0 && (
                <div className="flex items-center justify-between text-theme-sm text-gray-500 dark:text-gray-400">
                  <dt>Running total</dt>
                  <dd className="tabular-nums">{money(ticket.running_total)}</dd>
                </div>
              )}
              {paidTotal > 0 && (
                <div className="flex items-center justify-between text-theme-sm text-gray-500 dark:text-gray-400">
                  <dt>Paid</dt>
                  <dd className="tabular-nums">− {money(paidTotal)}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between">
                <dt className="text-sm font-medium text-gray-600 dark:text-gray-300">
                  {paidTotal > 0 ? "Still to pay" : "Running total"}
                  {taxRate > 0 && <span className="ml-1 text-theme-xs font-normal text-gray-400">+ tax at the bill</span>}
                </dt>
                <dd className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
                  {money(paidTotal > 0 ? toPay : ticket.running_total)}
                </dd>
              </div>
            </dl>
            {/* THE NEXT THING TO DO IS THE BIG ONE. With food waiting to be
                sent, that is sending it; with nothing waiting, it is the bill.
                The two were always the same size, side by side, and the one a
                waiter forgets — sending — was the quieter of the two. */}
            {/* …and between them, the bill on paper. "Bill please" is asked at
                every table, every time, and the only paper with a total on it
                was the invoice — which is printed after the money has changed
                hands. It sits in this row rather than under it: the footer is
                pinned on a phone, and a fourth line of it is a dish the
                waiter cannot see. */}
            <div className={`grid gap-2 ${firable.length > 0 ? "grid-cols-[2fr_auto_1fr]" : "grid-cols-[1fr_auto_2fr]"}`}>
              <button
                type="button"
                onClick={onFire}
                disabled={firable.length === 0 || fire.isPending || lines.busy || !mine}
                className={`min-h-14 rounded-xl px-3 text-base font-bold transition disabled:opacity-40 ${
                  firable.length > 0
                    ? "bg-warning-500 text-gray-900 hover:bg-warning-400 active:bg-warning-600"
                    : "text-gray-500 ring-1 ring-inset ring-gray-200 dark:text-gray-400 dark:ring-gray-700"
                }`}
              >
                {fire.isPending ? "Sending…" : firable.length > 0 ? `Send to kitchen (${toSendCount})` : "Send to kitchen"}
              </button>
              <button
                type="button"
                onClick={onPrintBill}
                // A read: whoever can see the tab may print what it owes —
                // not only the waiter whose table it is.
                disabled={unsettled.length === 0 || printingBill || lines.busy}
                aria-label="Print bill"
                title="Print the bill — what this table owes, before it pays"
                data-testid="print-bill"
                className="flex min-h-14 min-w-14 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-gray-700 ring-1 ring-inset ring-gray-200 transition hover:bg-gray-50 disabled:opacity-40 dark:text-gray-200 dark:ring-gray-700 dark:hover:bg-white/5"
              >
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M6 7V3.5h8V7M6 14H4.5A1.5 1.5 0 0 1 3 12.5v-4A1.5 1.5 0 0 1 4.5 7h11A1.5 1.5 0 0 1 17 8.5v4a1.5 1.5 0 0 1-1.5 1.5H14M6 11.5h8v5H6v-5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
                <span className="text-[11px] font-semibold leading-none">{printingBill ? "…" : "Bill"}</span>
              </button>
              <button
                type="button"
                onClick={openSettle}
                disabled={unsettled.length === 0 || !mine}
                className={`min-h-14 rounded-xl px-3 text-base font-bold transition disabled:opacity-40 ${
                  firable.length > 0
                    ? "text-gray-700 ring-1 ring-inset ring-gray-200 hover:bg-gray-50 dark:text-gray-200 dark:ring-gray-700 dark:hover:bg-white/5"
                    : "bg-brand-500 text-white hover:bg-brand-600"
                }`}
              >
                Settle
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* The header's controls, for a phone. Each closes the sheet and
          opens what it always opened. */}
      <Modal isOpen={moreModal.isOpen} onClose={moreModal.closeModal} className="max-w-sm p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">
          {ticket.table?.name ?? "Takeaway"} · {ticket.ticket_number}
        </h3>
        <div className="grid gap-2">
          <button type="button" className={`${HEAD_ACTION} justify-center`} onClick={() => { moreModal.closeModal(); setMoveTable(ticket.table?.id ?? ""); moveModal.openModal(); }}>
            Move table
          </button>
          <button type="button" className={`${HEAD_ACTION} justify-center`} onClick={() => { moreModal.closeModal(); setMergeSource(""); mergeModal.openModal(); }}>
            Merge tab
          </button>
          <button type="button" className={`${HEAD_ACTION} justify-center`} onClick={() => { moreModal.closeModal(); setHandTo(""); handOverModal.openModal(); }}>
            Hand over
          </button>
          <button type="button" className={`${HEAD_ACTION_DANGER} justify-center`} onClick={() => { moreModal.closeModal(); onCancel(); }}>
            Cancel tab
          </button>
        </div>
      </Modal>

      {/* A note for the kitchen, on a line not yet sent. */}
      <Modal isOpen={noteModal.isOpen} onClose={noteModal.closeModal} className="max-w-sm p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Kitchen note</h3>
        <p className="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">
          {noteFor ? `${Number(noteFor.quantity)}× ${noteFor.product_name}` : ""} — printed on the kitchen ticket, in capitals.
        </p>
        <Label htmlFor="tab-note">Note</Label>
        <Input
          id="tab-note"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="e.g. No green chilli"
        />
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Common notes">
          {QUICK_NOTES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setNoteText((t) => (t.trim() === "" ? q : t.includes(q) ? t : `${t.trim()}, ${q}`))}
              className="inline-flex min-h-10 items-center rounded-xl bg-gray-100 px-3 text-theme-xs font-semibold text-gray-700 hover:bg-gray-200 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20"
            >
              {q}
            </button>
          ))}
        </div>
        <div className="mt-6 flex justify-between gap-3">
          {noteFor?.note ? (
            <Button size="sm" variant="danger" onClick={() => { setNoteText(""); lines.note(noteFor, "").catch(() => toast.error("Couldn't clear the note.")); noteModal.closeModal(); }}>
              Remove note
            </Button>
          ) : <span />}
          <div className="flex gap-3">
            <Button size="sm" variant="outline" onClick={noteModal.closeModal}>Cancel</Button>
            <Button size="sm" onClick={saveNote}>Save note</Button>
          </div>
        </div>
      </Modal>

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
            // The list is fetched when this sheet opens. Until it answers the
            // box says so — it used to read "Choose a tab" over a list with
            // nothing in it, which on a slow line looks like no other table
            // is open.
            { value: "", label: openTabs.isPending ? "Loading…" : "— Choose a tab —" },
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
                  {/* WHICH ONE. A table with a Half and a Full is deciding
                      who pays for which; "Karahi" twice does not help. */}
                  <p className="truncate text-theme-sm text-gray-700 dark:text-gray-200">{lineName(i)}</p>
                  {lineExtras(i) !== "" && <p className="truncate text-theme-xs text-gray-500 dark:text-gray-400">{lineExtras(i)}</p>}
                  <p className="text-theme-xs text-gray-400">{lineQty}× · {money(i.line_total)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setQ(q - 1)}
                    disabled={q <= 0}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                    aria-label={`Settle less ${lineSpoken(i)}`}
                  >−</button>
                  <span className="w-7 text-center text-theme-sm tabular-nums text-gray-800 dark:text-white/90">{q}</span>
                  <button
                    type="button"
                    onClick={() => setQ(q + 1)}
                    disabled={q >= lineQty}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                    aria-label={`Settle more ${lineSpoken(i)}`}
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
              { value: "wallet", label: "Mobile wallet" },
            ]}
            value={method}
            onChange={setMethod}
          />

          {/* SPLIT THE TENDER, not the bill. Splitting the BILL is the item
              counter above; this is one bill paid with two things. Hidden
              until asked for, because most tables pay with one. */}
          {splitMethod === "" ? (
            <button
              type="button"
              onClick={() => setSplitMethod(method === "cash" ? "card" : "cash")}
              className="mt-2 text-theme-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              + Pay with two methods
            </button>
          ) : (
            <div className="mt-2 space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
              <div className="flex items-center justify-between">
                <Label className="mb-0">And the rest by</Label>
                <button
                  type="button"
                  onClick={() => { setSplitMethod(""); setSplitAmount(""); }}
                  className="text-theme-xs font-medium text-error-500 hover:text-error-600"
                >
                  Remove
                </button>
              </div>
              <Select
                options={[
                  { value: "cash", label: "Cash" },
                  { value: "card", label: "Card" },
                  { value: "bank_transfer", label: "Bank transfer" },
                  { value: "wallet", label: "Mobile wallet" },
                ]}
                value={splitMethod}
                onChange={setSplitMethod}
              />
              <Input
                type="number"
                min="0"
                value={splitAmount}
                onChange={(e) => setSplitAmount(e.target.value)}
                placeholder="Amount on this method"
              />
              <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                {splitPaid > 0
                  ? <>{money(firstPaid)} on {method}, {money(splitPaid)} on {splitMethod}.</>
                  : <>Type what goes on {splitMethod}; the rest stays on {method}.</>}
              </p>
            </div>
          )}
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
  return `inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-xl px-3.5 text-theme-sm font-semibold transition-colors ${
    active
      ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
      : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20"
  }`;
}
