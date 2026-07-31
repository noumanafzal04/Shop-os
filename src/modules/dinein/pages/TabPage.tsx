import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useMoney, useShopSettings } from "../../shop/hooks/useShop";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Select from "../../../components/form/Select";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useToast } from "../../../components/ui/toast";
import { useConfirm } from "../../../components/ui/confirm";
import { catalogService } from "../../catalog/services/catalogService";
import type { Product, ModifierGroup } from "../../catalog/types";
import { useTicket, useDineInMutations } from "../hooks/useDineIn";
import type { TicketItem } from "../services/dineInService";

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
  const settings = useShopSettings();
  const taxRate = Number(settings.data?.default_tax_rate ?? 0);
  const { addItems, voidItem, fire, settle, cancel } = useDineInMutations(id);

  const products = useQuery({
    queryKey: ["catalog", "menu"],
    queryFn: async () => (await catalogService.products({})).data,
    staleTime: 60_000,
  });
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
  const [picked, setPicked] = useState<Record<string, string[]>>({}); // groupId -> optionIds

  // Settle — per-line quantity chosen for this payment (0 = skip the line,
  // < line qty = split part of it, = line qty = the whole line).
  const settleModal = useModal();
  const [settleQty, setSettleQty] = useState<Record<string, number>>({});
  const [method, setMethod] = useState("cash");

  const liveItems = useMemo(
    () => (ticket?.items ?? []).filter((i) => !i.voided_at && i.kot_status !== "void"),
    [ticket],
  );
  const unsettled = liveItems.filter((i) => !i.sale_id);
  const firable = unsettled.filter((i) => i.kot_status === "pending");

  const menu = (products.data ?? []).filter((p) => {
    if (catFilter && p.category_id !== catFilter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const addProduct = (p: Product) => {
    if (p.modifier_groups && p.modifier_groups.length > 0) {
      const seed: Record<string, string[]> = {};
      p.modifier_groups.forEach((g) => {
        seed[g.id ?? g.name] = g.options.filter((o) => o.is_default && o.id).map((o) => o.id as string);
      });
      setModProduct(p);
      setPicked(seed);
      modModal.openModal();
      return;
    }
    fireAdd(p.id, []);
  };

  const fireAdd = (productId: string, modifierOptionIds: string[], note?: string) => {
    if (!id) return;
    addItems.mutate(
      { id, items: [{ product_id: productId, quantity: 1, modifier_option_ids: modifierOptionIds, note }] },
      { onError: () => toast.error("Couldn't add the item.") },
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
    fireAdd(modProduct.id, ids);
    modModal.closeModal();
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
        onSuccess: (res) => toast.success(`Kitchen ticket #${res.data.kot_number} sent`),
        onError: () => toast.error("Couldn't fire the order."),
      },
    );
  };

  const openSettle = () => {
    // Default: every unsettled line at its full quantity = the whole bill.
    setSettleQty(Object.fromEntries(unsettled.map((i) => [i.id, Number(i.quantity)])));
    setMethod("cash");
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
  const settleDue = Math.round((settleSubtotal + settleTax) * 100) / 100;
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
    return <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
    </div>;
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50 dark:bg-gray-950">
      <PageMeta title={`Tab ${ticket.ticket_number} | ShopOS`} description="Dine-in tab" />

      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate("/tenant/dine-in")} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">
            ← Floor
          </button>
          <div>
            <h1 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              {ticket.table?.name ?? "Takeaway"} · {ticket.ticket_number}
            </h1>
            <p className="text-theme-xs text-gray-400">
              {ticket.order_type === "dine_in" ? "Dine-in" : "Takeaway"}
              {ticket.guest_count ? ` · ${ticket.guest_count} guests` : ""}
            </p>
          </div>
        </div>
        <button onClick={onCancel} className="text-theme-sm text-error-500 hover:text-error-600">Cancel tab</button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Menu */}
        <div className="flex w-3/5 flex-col border-r border-gray-200 dark:border-gray-800">
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
              menu.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addProduct(p)}
                  disabled={addItems.isPending}
                  className="flex h-24 flex-col justify-between rounded-xl border border-gray-200 bg-white p-3 text-left transition-colors hover:border-brand-400 disabled:opacity-50 dark:border-gray-800 dark:bg-white/[0.03]"
                >
                  <span className="line-clamp-2 text-theme-sm font-medium text-gray-800 dark:text-white/90">{p.name}</span>
                  <span className="text-theme-sm font-semibold text-brand-500">{money(p.price)}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Tab */}
        <div className="flex w-2/5 flex-col">
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
                          {!i.sale_id && (
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
              <Button size="sm" variant="outline" onClick={onFire} disabled={firable.length === 0 || fire.isPending}>
                {fire.isPending ? "Firing…" : `Fire to kitchen${firable.length ? ` (${firable.length})` : ""}`}
              </Button>
              <Button size="sm" onClick={openSettle} disabled={unsettled.length === 0}>Settle</Button>
            </div>
          </div>
        </div>
      </div>

      {/* Modifier picker */}
      <Modal isOpen={modModal.isOpen} onClose={modModal.closeModal} className="max-w-md p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">{modProduct?.name}</h3>
        <div className="max-h-[50vh] space-y-4 overflow-y-auto">
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
                  {g.options.map((o) => (
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
      <Modal isOpen={settleModal.isOpen} onClose={settleModal.closeModal} className="max-w-md p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Settle tab</h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Choose how many of each item to settle — leave every line at its full count for the whole tab, or lower one to split part of it.
        </p>
        <div className="mb-4 max-h-[40vh] space-y-1 overflow-y-auto">
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
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Total</span>
            <span className="text-lg font-bold text-gray-800 dark:text-white/90">{money(settleDue)}</span>
          </div>
        </div>
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
