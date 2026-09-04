import { useState } from "react";
import TableEmpty from "../../../components/ui/table/TableEmpty";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Select from "../../../components/form/Select";
import Label from "../../../components/form/Label";
import Badge from "../../../components/ui/badge/Badge";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useConfirm } from "../../../components/ui/confirm";
import { failed } from "../../../common/api/failed";
import { useToast } from "../../../components/ui/toast";
import { useMoney } from "../../shop/hooks/useShop";
import { useCategories } from "../../catalog/hooks/useCatalog";
import { catalogService } from "../../catalog/services/catalogService";
import { usePromotions, usePromotionMutations } from "../hooks/usePromotions";
import type { Promotion, PromoScope, PromoType } from "../services/promotionsService";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Draft {
  id?: string;
  name: string;
  type: PromoType;
  value: string;
  scope: PromoScope;
  category_id: string;
  products: Array<{ id: string; name: string }>;
  min_spend: string;
  min_qty: string;
  buy_qty: string;
  get_qty: string;
  get_discount_pct: string;
  max_discount: string;
  starts_on: string;
  ends_on: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  is_active: boolean;
}

const blank: Draft = {
  name: "", type: "percent", value: "", scope: "order", category_id: "", products: [],
  min_spend: "", min_qty: "", buy_qty: "1", get_qty: "1", get_discount_pct: "100",
  max_discount: "", starts_on: "", ends_on: "",
  days_of_week: [], start_time: "", end_time: "", is_active: true,
};

function scheduleLabel(p: Promotion): string {
  const bits: string[] = [];
  if (p.starts_on || p.ends_on) bits.push(`${p.starts_on ?? "…"} → ${p.ends_on ?? "…"}`);
  if (p.days_of_week?.length) bits.push(p.days_of_week.map((d) => DAYS[d]).join(","));
  if (p.start_time && p.end_time) bits.push(`${p.start_time.slice(0, 5)}–${p.end_time.slice(0, 5)}`);
  return bits.join(" · ") || "Always";
}

export default function PromotionsPage() {
  const money = useMoney();
  const { data: promotions, isLoading } = usePromotions();
  const { create, update, remove } = usePromotionMutations();
  const categories = useCategories();
  const modal = useModal();
  const confirm = useConfirm();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(blank);
  const [productSearch, setProductSearch] = useState("");
  const [productHits, setProductHits] = useState<Array<{ id: string; name: string }>>([]);
  const isEdit = !!draft.id;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const openNew = () => { setDraft(blank); setProductHits([]); setProductSearch(""); modal.openModal(); };
  const openEdit = (p: Promotion) => {
    setDraft({
      id: p.id, name: p.name, type: p.type, value: String(p.value), scope: p.scope,
      category_id: p.category_id ?? "",
      products: (p.product_ids ?? []).map((id) => ({ id, name: p.category?.name ?? id })),
      min_spend: p.min_spend != null ? String(p.min_spend) : "",
      min_qty: p.min_qty != null ? String(p.min_qty) : "",
      buy_qty: p.buy_qty != null ? String(p.buy_qty) : "1",
      get_qty: p.get_qty != null ? String(p.get_qty) : "1",
      get_discount_pct: p.get_discount_pct != null ? String(p.get_discount_pct) : "100",
      max_discount: p.max_discount != null ? String(p.max_discount) : "",
      starts_on: p.starts_on ?? "", ends_on: p.ends_on ?? "",
      days_of_week: p.days_of_week ?? [],
      start_time: p.start_time?.slice(0, 5) ?? "", end_time: p.end_time?.slice(0, 5) ?? "",
      is_active: p.is_active,
    });
    modal.openModal();
  };

  const searchProducts = async (term: string) => {
    setProductSearch(term);
    if (term.trim().length < 2) { setProductHits([]); return; }
    const res = await catalogService.products({ search: term.trim() });
    setProductHits(res.data.map((p) => ({ id: p.id, name: p.name })));
  };

  const toggleDay = (d: number) =>
    set("days_of_week", draft.days_of_week.includes(d) ? draft.days_of_week.filter((x) => x !== d) : [...draft.days_of_week, d].sort());

  const isBogo = draft.type === "bogo";

  const save = () => {
    if (!draft.name.trim()) return;
    if (!isBogo && !draft.value) return;
    if (isBogo && (!draft.buy_qty || !draft.get_qty)) return;
    // bogo only makes sense scoped to a category / product set.
    const scope = isBogo && draft.scope === "order" ? "category" : draft.scope;
    const payload = {
      name: draft.name.trim(),
      type: draft.type,
      value: isBogo ? 0 : Number(draft.value),
      scope,
      category_id: scope === "category" ? draft.category_id || null : null,
      product_ids: scope === "product" ? draft.products.map((p) => p.id) : null,
      min_spend: draft.min_spend ? Number(draft.min_spend) : null,
      min_qty: draft.min_qty ? Number(draft.min_qty) : null,
      buy_qty: isBogo ? Number(draft.buy_qty) : null,
      get_qty: isBogo ? Number(draft.get_qty) : null,
      get_discount_pct: isBogo ? (draft.get_discount_pct ? Number(draft.get_discount_pct) : 100) : null,
      max_discount: draft.max_discount ? Number(draft.max_discount) : null,
      starts_on: draft.starts_on || null,
      ends_on: draft.ends_on || null,
      days_of_week: draft.days_of_week.length ? draft.days_of_week : null,
      start_time: draft.start_time || null,
      end_time: draft.end_time || null,
      is_active: draft.is_active,
    };
    const done = {
      onSuccess: () => { toast.success(isEdit ? "Promotion updated" : "Promotion created"); modal.closeModal(); },
      // A promotion takes money off a bill. One that did not save leaves the
      // counter charging the old price with nothing said.
      ...failed(toast, "That promotion did not save — the counter still has the old one."),
    };
    if (isEdit) update.mutate({ id: draft.id!, ...payload }, done);
    else create.mutate(payload, done);
  };

  const del = async (p: Promotion) => {
    if (await confirm({ title: `Remove "${p.name}"?`, tone: "danger", confirmLabel: "Remove" })) {
      remove.mutate(p.id, {
        onSuccess: () => toast.success("Promotion removed"),
        ...failed(toast, "That promotion is still running."),
      });
    }
  };

  const catOptions = [{ value: "", label: "— Select category —" }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))];

  return (
    <>
      <PageMeta title="Promotions | CartZe" description="Automatic scheduled discounts" />
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-title-sm font-semibold text-gray-800 dark:text-white/90">Promotions</h1>
          <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">Automatic discounts — no code needed. The best live one applies at the till.</p>
        </div>
        <Button size="sm" onClick={openNew}>+ New promotion</Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-theme-sm">
            <thead className="bg-gray-50 text-theme-xs uppercase text-gray-400 dark:bg-white/5">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Discount</th>
                <th className="px-4 py-3">Applies to</th>
                <th className="px-4 py-3">Schedule</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {isLoading ? (
                <tr><TableEmpty colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading…</TableEmpty></tr>
              ) : (promotions ?? []).length === 0 ? (
                <tr><TableEmpty colSpan={6} className="px-4 py-8 text-center text-gray-400">No promotions yet.</TableEmpty></tr>
              ) : (
                (promotions ?? []).map((p) => (
                  <tr key={p.id} className="text-gray-700 dark:text-gray-300">
                    <td className="px-4 py-3 font-medium text-gray-800 dark:text-white/90">{p.name}</td>
                    <td className="px-4 py-3">
                      {p.type === "percent"
                        ? `${Number(p.value)}%`
                        : p.type === "bogo"
                          ? `Buy ${Number(p.buy_qty ?? 1)} Get ${Number(p.get_qty ?? 1)}${Number(p.get_discount_pct ?? 100) < 100 ? ` (${Number(p.get_discount_pct)}% off)` : " Free"}`
                          : money(p.value)}
                    </td>
                    <td className="px-4 py-3 capitalize">
                      {p.scope === "order" ? "Whole order" : p.scope === "category" ? `Category: ${p.category?.name ?? "—"}` : `${p.product_ids?.length ?? 0} product(s)`}
                    </td>
                    <td className="px-4 py-3 text-theme-xs text-gray-500">{scheduleLabel(p)}</td>
                    <td className="px-4 py-3"><Badge size="sm" color={p.is_active ? "success" : "light"}>{p.is_active ? "Active" : "Off"}</Badge></td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => openEdit(p)} className="mr-3 text-theme-xs font-medium text-brand-500 hover:text-brand-600">Edit</button>
                      <button onClick={() => del(p)} className="text-theme-xs font-medium text-error-500 hover:text-error-600">Remove</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-2xl p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">{isEdit ? "Edit promotion" : "New promotion"}</h3>
        <div className="max-h-[70dvh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><Label>Name</Label><Input value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Eid Weekend Sale" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Discount</Label>
                <Select value={draft.type} options={[{ value: "percent", label: "Percent %" }, { value: "fixed", label: "Fixed (Rs)" }, { value: "bogo", label: "Buy X Get Y" }]}
                  onChange={(v) => { set("type", v as PromoType); if (v === "bogo" && draft.scope === "order") set("scope", "category"); }} />
              </div>
              {!isBogo && <div><Label>Value</Label><Input type="number" min="0" value={draft.value} onChange={(e) => set("value", e.target.value)} /></div>}
            </div>
          </div>

          {isBogo && (
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-gray-100 p-3 dark:border-gray-800">
              <div><Label>Buy qty</Label><Input type="number" min="1" value={draft.buy_qty} onChange={(e) => set("buy_qty", e.target.value)} /></div>
              <div><Label>Get qty</Label><Input type="number" min="1" value={draft.get_qty} onChange={(e) => set("get_qty", e.target.value)} /></div>
              <div><Label>Discount %</Label><Input type="number" min="1" max="100" value={draft.get_discount_pct} onChange={(e) => set("get_discount_pct", e.target.value)} placeholder="100 = free" /></div>
              <p className="col-span-3 text-theme-xs text-gray-400">Buy {draft.buy_qty || "1"}, get {draft.get_qty || "1"} of the cheapest at {draft.get_discount_pct || "100"}% off. The customer gets the cheapest qualifying units.</p>
            </div>
          )}

          <div>
            <Label>Applies to</Label>
            <Select value={draft.scope}
              options={isBogo
                ? [{ value: "category", label: "A category" }, { value: "product", label: "Specific products" }]
                : [{ value: "order", label: "Whole order" }, { value: "category", label: "A category" }, { value: "product", label: "Specific products" }]}
              onChange={(v) => set("scope", v as PromoScope)} />
          </div>

          {draft.scope === "category" && (
            <div><Label>Category</Label><Select value={draft.category_id} options={catOptions} onChange={(v) => set("category_id", v)} /></div>
          )}

          {draft.scope === "product" && (
            <div>
              <Label>Products</Label>
              <Input value={productSearch} onChange={(e) => searchProducts(e.target.value)} placeholder="Search products to add…" />
              {productHits.length > 0 && (
                <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
                  {productHits.map((h) => (
                    <button key={h.id} type="button" onClick={() => { if (!draft.products.some((p) => p.id === h.id)) set("products", [...draft.products, h]); setProductHits([]); setProductSearch(""); }}
                      className="block w-full px-3 py-1.5 text-left text-theme-sm hover:bg-gray-50 dark:hover:bg-white/5">{h.name}</button>
                  ))}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {draft.products.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-theme-xs text-brand-600 dark:bg-brand-500/10">
                    {p.name}
                    <button type="button" onClick={() => set("products", draft.products.filter((x) => x.id !== p.id))} className="text-brand-400 hover:text-error-500">×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {!isBogo && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {draft.scope === "order"
                ? <div><Label>Min spend (Rs)</Label><Input type="number" min="0" value={draft.min_spend} onChange={(e) => set("min_spend", e.target.value)} placeholder="None" /></div>
                : <div><Label>Min quantity</Label><Input type="number" min="0" value={draft.min_qty} onChange={(e) => set("min_qty", e.target.value)} placeholder="None" /></div>}
              {draft.type === "percent" && <div><Label>Max discount (Rs)</Label><Input type="number" min="0" value={draft.max_discount} onChange={(e) => set("max_discount", e.target.value)} placeholder="No cap" /></div>}
            </div>
          )}

          <div className="rounded-lg border border-gray-100 p-3 dark:border-gray-800">
            <p className="mb-2 text-theme-xs font-medium uppercase text-gray-400">Schedule <span className="font-normal normal-case text-gray-400">— leave blank for always-on</span></p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div><Label>Starts on</Label><Input type="date" value={draft.starts_on} onChange={(e) => set("starts_on", e.target.value)} /></div>
              <div><Label>Ends on</Label><Input type="date" value={draft.ends_on} onChange={(e) => set("ends_on", e.target.value)} /></div>
            </div>
            <div className="mt-3">
              <Label>Days of week</Label>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d, i) => (
                  <button key={d} type="button" onClick={() => toggleDay(i)}
                    className={`rounded-md px-2.5 py-1 text-theme-xs font-medium ${draft.days_of_week.includes(i) ? "bg-brand-500 text-white" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"}`}>{d}</button>
                ))}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div><Label>From (time)</Label><Input type="time" value={draft.start_time} onChange={(e) => set("start_time", e.target.value)} /></div>
              <div><Label>To (time)</Label><Input type="time" value={draft.end_time} onChange={(e) => set("end_time", e.target.value)} /></div>
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={draft.is_active} onChange={(e) => set("is_active", e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500" />
            Active
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
          <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={!draft.name.trim() || (isBogo ? (!draft.buy_qty || !draft.get_qty) : !draft.value) || create.isPending || update.isPending}>{isEdit ? "Save" : "Create"}</Button>
        </div>
      </Modal>
    </>
  );
}
