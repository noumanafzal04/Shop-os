import { useState } from "react";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Label from "../../../components/form/Label";
import Input from "../../../components/form/input/InputField";
import Select from "../../../components/form/Select";
import Alert from "../../../components/ui/alert/Alert";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { ApiError } from "../../../common/types/api";
import { usePlanMutations, usePlans } from "../hooks/useAdmin";
import type { Plan } from "../services/adminService";

const money = (n: string | number) => `Rs ${Number(n).toLocaleString()}`;
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const blank = {
  name: "",
  code: "",
  description: "",
  price: "0",
  billing_period_months: "1",
  online_shop_enabled: "false",
  grace_period_days: "7",
  is_active: true,
};

export default function AdminPlansPage() {
  const plans = usePlans();
  const { create, update, remove } = usePlanMutations();
  const modal = useModal();

  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState({ ...blank });
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = editing ? update : create;
  const apiError = mutation.error instanceof ApiError ? mutation.error : null;
  const errorFor = (k: string) => apiError?.errors[k]?.[0];
  const generalError = apiError && Object.keys(apiError.errors).length === 0 ? apiError.message : null;

  const openCreate = () => {
    setEditing(null);
    setForm({ ...blank });
    create.reset();
    modal.openModal();
  };

  const openEdit = (plan: Plan) => {
    setEditing(plan);
    setForm({
      name: plan.name,
      code: plan.code,
      description: plan.description ?? "",
      price: String(plan.price),
      billing_period_months: String(plan.billing_period_months ?? 1),
      online_shop_enabled: String(plan.online_shop_enabled),
      grace_period_days: String(plan.grace_period_days ?? 7),
      is_active: plan.is_active ?? true,
    });
    update.reset();
    modal.openModal();
  };

  const submit = () => {
    const payload = {
      name: form.name.trim(),
      code: form.code.trim() || slugify(form.name),
      description: form.description.trim() || undefined,
      price: Number(form.price),
      billing_period_months: Number(form.billing_period_months),
      online_shop_enabled: form.online_shop_enabled === "true",
      grace_period_days: Number(form.grace_period_days),
      is_active: form.is_active,
    };
    if (editing) {
      update.mutate({ id: editing.id, ...payload }, { onSuccess: modal.closeModal });
    } else {
      create.mutate(payload, { onSuccess: modal.closeModal });
    }
  };

  const toggleActive = (plan: Plan) =>
    update.mutate({ id: plan.id, is_active: !plan.is_active });

  const deletePlan = (plan: Plan) => {
    if (window.confirm(`Delete "${plan.name}"? (Only possible if no tenant uses it.)`)) {
      remove.mutate(plan.id, {
        onError: (e) => window.alert(e instanceof ApiError ? e.message : "Delete failed."),
      });
    }
  };

  const rows = plans.data ?? [];

  return (
    <>
      <PageMeta title="Plans | ShopOS Admin" description="Subscription plans" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Plans</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Define what businesses can subscribe to
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>+ New Plan</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-44 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
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
                <div className="mb-4 flex flex-wrap gap-2">
                  <Badge size="sm" color={plan.online_shop_enabled ? "info" : "light"}>
                    {plan.online_shop_enabled ? "Online Shop" : "Expense only"}
                  </Badge>
                  <Badge size="sm" color="light">{plan.grace_period_days ?? 7}d grace</Badge>
                  {plan.tenants_count !== undefined && (
                    <Badge size="sm" color="light">{plan.tenants_count} tenants</Badge>
                  )}
                </div>
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
        {generalError && <div className="mb-4"><Alert variant="error" title="Couldn't save" message={generalError} /></div>}

        <div className="space-y-4">
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
          <div>
            <Label>Online Shop</Label>
            <Select
              defaultValue={form.online_shop_enabled}
              options={[
                { value: "false", label: "Expense Manager only" },
                { value: "true", label: "Includes Online Shop" },
              ]}
              placeholder="Expense Manager only"
              onChange={(v) => set("online_shop_enabled", v)}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" className="h-4 w-4" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} />
            Active (assignable to tenants)
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={mutation.isPending || !form.name.trim()}>
            {mutation.isPending ? "Saving…" : editing ? "Save changes" : "Create plan"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
