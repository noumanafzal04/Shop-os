import { useState } from "react";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Label from "../../../components/form/Label";
import Input from "../../../components/form/input/InputField";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useToast } from "../../../components/ui/toast";
import { useConfirm } from "../../../components/ui/confirm";
import { ApiError } from "../../../common/types/api";
import { usePlanMutations, usePlans } from "../hooks/useAdmin";
import type { Plan } from "../services/adminService";

const money = (n: string | number) => `Rs ${Number(n).toLocaleString()}`;
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A limit value → human text. null = unlimited. */
const fmtLimit = (n: number | null | undefined) =>
  n == null ? "Unlimited" : n.toLocaleString();
const fmtStorage = (mb: number | null | undefined) =>
  mb == null ? "Unlimited" : mb >= 1024 ? `${(mb / 1024).toLocaleString()} GB` : `${mb} MB`;

const blank = {
  name: "",
  code: "",
  description: "",
  price: "0",
  billing_period_months: "1",
  grace_period_days: "7",
  // Modules the plan includes (the "base" the admin picks). POS bundles
  // Expense & Income, so `mod_expenses` only stands alone when POS is off.
  mod_pos: true,
  mod_expenses: true,
  mod_online: false,
  // Limits — blank string = unlimited.
  products: "",
  branches: "",
  staff: "",
  storage_mb: "",
  is_active: true,
};

export default function AdminPlansPage() {
  const plans = usePlans();
  const { create, update, remove } = usePlanMutations();
  const modal = useModal();
  const toast = useToast();
  const confirm = useConfirm();

  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState({ ...blank });
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  // A plan with POS or Online has a product catalog → product/branch/storage
  // limits apply. Expense-only plans have none of those. POS bundles Expense.
  const sells = form.mod_pos || form.mod_online;
  const noModule = !form.mod_pos && !form.mod_expenses && !form.mod_online;

  const mutation = editing ? update : create;
  const apiError = mutation.error instanceof ApiError ? mutation.error : null;
  const errorFor = (k: string) => apiError?.errors[k]?.[0];
  // Field validation shows inline (errorFor); a general failure is a toast.
  const toastGeneralError = (e: unknown) => {
    if (e instanceof ApiError && Object.keys(e.errors).length > 0) return; // inline handles it
    toast.error(e instanceof ApiError ? e.message : "Couldn't save plan.");
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...blank });
    create.reset();
    modal.openModal();
  };

  const openEdit = (plan: Plan) => {
    setEditing(plan);
    const lim = plan.limits;
    const f = plan.features ?? {};
    const str = (n: number | null | undefined) => (n == null ? "" : String(n));
    const pos = f.pos ?? true; // legacy plans w/o a module map default to POS
    setForm({
      name: plan.name,
      code: plan.code,
      description: plan.description ?? "",
      price: String(plan.price),
      billing_period_months: String(plan.billing_period_months ?? 1),
      grace_period_days: String(plan.grace_period_days ?? 7),
      mod_pos: pos,
      mod_expenses: f.expenses ?? pos,
      mod_online: plan.online_shop_enabled,
      products: str(lim?.products),
      branches: str(lim?.branches),
      staff: str(lim?.staff),
      storage_mb: str(lim?.storage_mb),
      is_active: plan.is_active ?? true,
    });
    update.reset();
    modal.openModal();
  };

  const submit = () => {
    const num = (v: string) => (v.trim() === "" ? null : Number(v));
    // POS bundles Expense; a catalog exists only when the plan sells.
    const features = {
      pos: form.mod_pos,
      expenses: form.mod_pos || form.mod_expenses,
      marketplace: form.mod_online,
      products: sells,
    };
    const payload = {
      name: form.name.trim(),
      code: form.code.trim() || slugify(form.name),
      price: Number(form.price),
      billing_period_months: Number(form.billing_period_months),
      online_shop_enabled: form.mod_online,
      grace_period_days: Number(form.grace_period_days),
      features,
      // null (not undefined) so CLEARING the description actually sends the
      // key — an undefined is dropped by JSON.stringify and the old text sticks.
      description: form.description.trim() || null,
      // Catalog-only limits don't apply to an expense-only plan.
      max_products: sells ? num(form.products) : null,
      max_branches: sells ? num(form.branches) : null,
      max_staff: num(form.staff),
      max_storage_mb: sells ? num(form.storage_mb) : null,
      is_active: form.is_active,
    };
    const done = (verb: string) => {
      toast.success(`Plan "${payload.name}" ${verb}`);
      modal.closeModal();
    };
    if (editing) {
      update.mutate({ id: editing.id, ...payload }, { onSuccess: () => done("updated"), onError: toastGeneralError });
    } else {
      create.mutate(payload, { onSuccess: () => done("created"), onError: toastGeneralError });
    }
  };

  const toggleActive = (plan: Plan) =>
    update.mutate(
      { id: plan.id, is_active: !plan.is_active },
      {
        onSuccess: () => toast.success(`"${plan.name}" ${plan.is_active ? "deactivated" : "activated"}`),
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't update plan."),
      },
    );

  const deletePlan = async (plan: Plan) => {
    const ok = await confirm({
      title: `Delete "${plan.name}"?`,
      message: "Only possible if no tenant uses it. This can't be undone.",
      confirmLabel: "Delete plan",
      tone: "danger",
    });
    if (!ok) return;
    remove.mutate(plan.id, {
      onSuccess: () => toast.success(`Deleted "${plan.name}"`),
      onError: (e) => toast.error(e instanceof ApiError ? e.message : "Delete failed."),
    });
  };

  const rows = plans.data ?? [];

  return (
    <>
      <PageMeta title="Plans | ShopOS Admin" description="Subscription plans" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Plans</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Define what businesses can subscribe to — modules and limits. Blank limit = unlimited.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>+ New Plan</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-56 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
            ))
          : rows.map((plan) => (
              <div
                key={plan.id}
                className="flex flex-col rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]"
              >
                <div className="mb-2 flex items-start justify-between">
                  <h3 className="font-semibold text-gray-800 dark:text-white/90">{plan.name}</h3>
                  <Badge size="sm" color={plan.is_active ? "success" : "light"}>
                    {plan.is_active ? "active" : "inactive"}
                  </Badge>
                </div>
                <p className="mb-1 text-2xl font-bold text-gray-800 dark:text-white/90">
                  {money(plan.price)}
                  <span className="text-sm font-normal text-gray-400">
                    {" "}/ {plan.billing_period_months ?? 1} mo
                  </span>
                </p>
                {plan.description && (
                  <p className="mb-3 text-theme-xs text-gray-500 dark:text-gray-400">{plan.description}</p>
                )}
                <div className="mb-3 flex flex-wrap gap-2">
                  {(plan.features?.pos ?? true) && <Badge size="sm" color="success">POS</Badge>}
                  {(plan.features?.expenses ?? true) && <Badge size="sm" color="light">Expense</Badge>}
                  {plan.online_shop_enabled && <Badge size="sm" color="info">Online</Badge>}
                  <Badge size="sm" color="light">{plan.grace_period_days ?? 7}d grace</Badge>
                  {plan.tenants_count !== undefined && (
                    <Badge size="sm" color="light">{plan.tenants_count} tenants</Badge>
                  )}
                </div>
                {plan.limits && (
                  <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-gray-100 pt-3 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                    <div className="flex justify-between"><dt>Products</dt><dd className="font-medium text-gray-700 dark:text-gray-300">{fmtLimit(plan.limits.products)}</dd></div>
                    <div className="flex justify-between"><dt>Branches</dt><dd className="font-medium text-gray-700 dark:text-gray-300">{fmtLimit(plan.limits.branches)}</dd></div>
                    <div className="flex justify-between"><dt>Staff</dt><dd className="font-medium text-gray-700 dark:text-gray-300">{fmtLimit(plan.limits.staff)}</dd></div>
                    <div className="flex justify-between"><dt>Storage</dt><dd className="font-medium text-gray-700 dark:text-gray-300">{fmtStorage(plan.limits.storage_mb)}</dd></div>
                  </dl>
                )}
                <div className="mt-auto flex gap-3 text-sm">
                  <button className="text-brand-500 hover:text-brand-600 dark:text-brand-400" onClick={() => openEdit(plan)}>
                    Edit
                  </button>
                  <button className="text-gray-500 hover:text-gray-700 dark:text-gray-400" onClick={() => toggleActive(plan)}>
                    {plan.is_active ? "Deactivate" : "Activate"}
                  </button>
                  <button className="text-error-500 hover:text-error-600" onClick={() => deletePlan(plan)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
      </div>

      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-lg p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">
          {editing ? `Edit ${editing.name}` : "New Plan"}
        </h3>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Name <span className="text-error-500">*</span></Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
              {errorFor("name") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("name")}</p>}
            </div>
            <div>
              <Label>Code {editing ? "" : "(auto if blank)"}</Label>
              <Input value={form.code} onChange={(e) => set("code", e.target.value)} placeholder={slugify(form.name)} />
              {errorFor("code") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("code")}</p>}
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Input value={form.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Price</Label>
              <Input type="number" min="0" value={form.price} onChange={(e) => set("price", e.target.value)} />
            </div>
            <div>
              <Label>Billing (mo)</Label>
              <Input type="number" min="1" value={form.billing_period_months} onChange={(e) => set("billing_period_months", e.target.value)} />
            </div>
            <div>
              <Label>Grace (days)</Label>
              <Input type="number" min="0" value={form.grace_period_days} onChange={(e) => set("grace_period_days", e.target.value)} />
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="mb-3">
              <p className="text-sm font-medium text-gray-800 dark:text-white/90">Modules included</p>
              <p className="text-theme-xs text-gray-400">Pick the base this plan sells. POS already includes Expense &amp; Income.</p>
            </div>
            <div className="space-y-2.5">
              <label className="flex cursor-pointer items-start gap-2.5 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.mod_pos} onChange={(e) => set("mod_pos", e.target.checked)} />
                <span>
                  <span className="font-medium">POS Business Management</span>
                  <span className="block text-theme-xs text-gray-400">Till, products, inventory, purchases, customers, reports — includes Expense &amp; Income</span>
                </span>
              </label>
              <label className={`flex items-start gap-2.5 text-sm ${form.mod_pos ? "cursor-not-allowed opacity-50" : "cursor-pointer"} text-gray-700 dark:text-gray-300`}>
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.mod_pos || form.mod_expenses} disabled={form.mod_pos} onChange={(e) => set("mod_expenses", e.target.checked)} />
                <span>
                  <span className="font-medium">Expense &amp; Income Manager</span>
                  <span className="block text-theme-xs text-gray-400">{form.mod_pos ? "Already included with POS" : "Standalone cash-flow tracking — no products, no sales"}</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.mod_online} onChange={(e) => set("mod_online", e.target.checked)} />
                <span>
                  <span className="font-medium">Online Commerce</span>
                  <span className="block text-theme-xs text-gray-400">Marketplace listing, online orders, delivery &amp; pickup, reviews, coupons</span>
                </span>
              </label>
            </div>
            {noModule && <p className="mt-2 text-theme-xs text-error-500">Select at least one module.</p>}
          </div>

          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="mb-3">
              <p className="text-sm font-medium text-gray-800 dark:text-white/90">Limits</p>
              <p className="text-theme-xs text-gray-400">
                {sells
                  ? "The shared baseline for this plan. Leave a field blank for unlimited — extend individual tenants from their detail page."
                  : "Expense-only plan — no product catalog, so only the staff limit applies."}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {sells && (
                <div>
                  <Label>Products</Label>
                  <Input type="number" min="1" value={form.products} onChange={(e) => set("products", e.target.value)} placeholder="Unlimited" />
                </div>
              )}
              {sells && (
                <div>
                  <Label>Branches</Label>
                  <Input type="number" min="1" value={form.branches} onChange={(e) => set("branches", e.target.value)} placeholder="Unlimited" />
                </div>
              )}
              <div>
                <Label>Staff</Label>
                <Input type="number" min="1" value={form.staff} onChange={(e) => set("staff", e.target.value)} placeholder="Unlimited" />
              </div>
              {sells && (
                <div>
                  <Label>Storage (MB)</Label>
                  <Input type="number" min="1" value={form.storage_mb} onChange={(e) => set("storage_mb", e.target.value)} placeholder="Unlimited" />
                </div>
              )}
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" className="h-4 w-4" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} />
            Active (assignable to tenants)
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={mutation.isPending || !form.name.trim() || noModule}>
            {mutation.isPending ? "Saving…" : editing ? "Save changes" : "Create plan"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
