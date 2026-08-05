import { useState } from "react";
import { Link, useParams } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Label from "../../../components/form/Label";
import Input from "../../../components/form/input/InputField";
import Select from "../../../components/form/Select";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useToast } from "../../../components/ui/toast";
import { useConfirm } from "../../../components/ui/confirm";
import { ApiError } from "../../../common/types/api";
import { useAdminTenant, useExtendLimits, useModuleCatalog, usePayments, usePlans, useTenantMutations, useUpdateModules } from "../hooks/useAdmin";
import type { Plan } from "../services/adminService";
import { useBusinessTypes } from "../../shop/hooks/useShop";
import { useEffect } from "react";
import type { Tenant } from "../../auth/types";

const money = (n: string | number) => `Rs ${Number(n).toLocaleString()}`;

/** Editable per-tenant limits (orders_month is never capped, so not shown). */
const EXTENDABLE: Array<{ key: "products" | "branches" | "staff" | "storage_mb"; label: string }> = [
  { key: "products", label: "Products" },
  { key: "branches", label: "Branches" },
  { key: "staff", label: "Staff" },
  { key: "storage_mb", label: "Storage (MB)" },
];

/**
 * Live usage vs the tenant's effective limits, with a per-tenant "Extend"
 * action. Extend overrides the plan baseline for THIS tenant only; clearing a
 * field (blank) falls back to the plan.
 */
function UsageLimitsCard({ tenant, plan }: { tenant: Tenant; plan?: Plan }) {
  const extend = useExtendLimits();
  const toast = useToast();
  const modal = useModal();
  const usage = tenant.limits_usage ?? [];
  const overrides = tenant.limit_overrides ?? {};

  // "add" is the default because the button says Extend, and extending by 100
  // means typing 100. Typing 100 into an absolute field on a 1,000 ceiling used
  // to CUT the shop to 100 — silently, with no way to notice until products
  // stopped saving.
  const [mode, setMode] = useState<"add" | "set">("add");
  const [form, setForm] = useState<Record<string, string>>({});
  const openExtend = () => {
    setMode("add");
    setForm(Object.fromEntries(EXTENDABLE.map(({ key }) => [key, ""])));
    extend.reset();
    modal.openModal();
  };

  const row = (key: string) => usage.find((u) => u.key === key);
  const planLimit = (key: string): number | null | undefined =>
    row(key)?.plan_limit ?? plan?.limits?.[key as keyof NonNullable<Plan["limits"]>];
  const fmt = (n: number | null | undefined) => (n == null ? "Unlimited" : n.toLocaleString());

  /** What this field will land on — the same arithmetic the server does. */
  const preview = (key: string): number | null => {
    const raw = (form[key] ?? "").trim();
    if (raw === "" || Number.isNaN(Number(raw))) return null;
    const current = row(key)?.limit;
    if (mode === "set") return Number(raw);
    if (current == null) return null; // already unlimited — nothing to add to
    return current + Number(raw);
  };

  /** The typo guard, shown before the request rather than after it fails. */
  const belowUsage = (key: string): boolean => {
    const next = preview(key);
    return next !== null && next < (row(key)?.used ?? 0);
  };
  const anyBelowUsage = EXTENDABLE.some(({ key }) => belowUsage(key));

  // Field validation shows inline; a general failure is a toast.
  const extErr = extend.error instanceof ApiError ? extend.error : null;
  const fieldErr = (key: string) => extErr?.errors[`limits.${key}`]?.[0];

  const save = () => {
    // Only send what was actually typed. Sending every field each time meant a
    // blank one cleared an override the admin never touched.
    const limits: Record<string, number | null> = {};
    for (const { key } of EXTENDABLE) {
      const v = (form[key] ?? "").trim();
      if (v === "") continue;
      limits[key] = Number(v);
    }
    if (Object.keys(limits).length === 0) {
      modal.closeModal();
      return;
    }
    extend.mutate(
      { id: tenant.id, limits, mode },
      {
        onSuccess: () => {
          toast.success("Limits updated");
          modal.closeModal();
        },
        onError: (e) => {
          if (e instanceof ApiError && Object.keys(e.errors).length > 0) return; // inline handles it
          toast.error(e instanceof ApiError ? e.message : "Couldn't update limits.");
        },
      },
    );
  };

  /** Drop a tenant back to the plan's own ceiling for one resource. */
  const clearOverride = (key: string) =>
    extend.mutate(
      { id: tenant.id, limits: { [key]: null } },
      {
        onSuccess: () => toast.success("Back to the plan limit"),
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't clear it."),
      },
    );

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold text-gray-800 dark:text-white/90">Plan usage &amp; limits</h3>
        <Button size="sm" variant="outline" onClick={openExtend}>Extend</Button>
      </div>

      {usage.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
          Assign a plan to meter usage.
        </p>
      ) : (
        <div className="space-y-4">
          {usage.map((u) => {
            const pct = u.limit && u.limit > 0 ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
            const bar = pct >= 100 ? "bg-error-500" : pct >= 80 ? "bg-warning-500" : "bg-brand-500";
            const extended = overrides[u.key] != null;
            const extra = u.extra ?? 0;
            return (
              <div key={u.key}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                    {u.label}
                    {/* Say what was granted, not just that something was. An
                        admin about to change a ceiling needs to know whether
                        1,100 is the plan or 1,000 plus 100 they gave in March. */}
                    {extended && (
                      <Badge size="sm" color={extra < 0 ? "warning" : "info"}>
                        {extra > 0 ? `+${extra.toLocaleString()}` : extra < 0 ? extra.toLocaleString() : "custom"}
                      </Badge>
                    )}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400">
                    {u.used.toLocaleString()}{" / "}
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {u.unlimited ? "∞" : u.limit?.toLocaleString()}
                    </span>
                  </span>
                </div>
                {!u.unlimited && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
                  </div>
                )}
                {extended && (
                  <div className="mt-1 flex items-center gap-2 text-theme-xs text-gray-400">
                    <span>Plan gives {fmt(u.plan_limit)}</span>
                    <button
                      type="button"
                      onClick={() => clearOverride(u.key)}
                      className="text-brand-500 hover:text-brand-600"
                    >
                      Reset to plan
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-md p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Extend limits</h3>
        <p className="mb-4 text-theme-xs text-gray-400">
          Only fill in what you want to change — anything left blank stays exactly as it is.
        </p>

        {/* The two meanings a number in this box can have. Making it a visible
            choice is the fix: the field used to be absolute-only while the
            button said "Extend", so typing the increase cut the ceiling to it. */}
        <div className="mb-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode("add")}
            className={`rounded-xl border p-3 text-left transition ${
              mode === "add"
                ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                : "border-gray-200 hover:border-gray-300 dark:border-gray-700"
            }`}
          >
            <div className={`text-sm font-medium ${mode === "add" ? "text-brand-600 dark:text-brand-400" : "text-gray-800 dark:text-white/90"}`}>
              Add to current
            </div>
            <div className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
              Type 100 to give 100 more.
            </div>
          </button>
          <button
            type="button"
            onClick={() => setMode("set")}
            className={`rounded-xl border p-3 text-left transition ${
              mode === "set"
                ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                : "border-gray-200 hover:border-gray-300 dark:border-gray-700"
            }`}
          >
            <div className={`text-sm font-medium ${mode === "set" ? "text-brand-600 dark:text-brand-400" : "text-gray-800 dark:text-white/90"}`}>
              Set exact total
            </div>
            <div className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
              Type 1,100 for a ceiling of 1,100.
            </div>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {EXTENDABLE.map(({ key, label }) => {
            const r = row(key);
            const next = preview(key);
            const bad = belowUsage(key);
            return (
              <div key={key}>
                <Label>{label}</Label>
                <Input
                  type="number"
                  value={form[key] ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  placeholder={mode === "add" ? "+ how many?" : fmt(r?.limit)}
                />
                {/* Now → after. The arithmetic is on screen before the request,
                    so a wrong number is caught by reading, not by an error. */}
                <p className={`mt-1 text-theme-xs ${bad ? "text-error-500" : "text-gray-400"}`}>
                  {bad ? (
                    <>Already using {r?.used.toLocaleString()} — can’t go to {next?.toLocaleString()}</>
                  ) : next !== null ? (
                    <>{fmt(r?.limit)} → <span className="font-medium text-gray-600 dark:text-gray-300">{next.toLocaleString()}</span></>
                  ) : (
                    <>Now {fmt(r?.limit)} · plan {fmt(planLimit(key))} · using {r?.used.toLocaleString() ?? 0}</>
                  )}
                </p>
                {fieldErr(key) && <p className="mt-1 text-theme-xs text-error-500">{fieldErr(key)}</p>}
              </div>
            );
          })}
        </div>

        {extErr && Object.keys(extErr.errors).length === 0 && (
          <p className="mt-4 text-theme-sm text-error-500">{extErr.message}</p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={extend.isPending || anyBelowUsage}>
            {extend.isPending ? "Saving…" : "Save limits"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/** Admin-only editor for a tenant's business type + category (owners can't). */
function BusinessTypeCard({ tenantId, current, currentCategory }: { tenantId: string; current: string | null; currentCategory: string | null }) {
  const businessTypes = useBusinessTypes();
  const { update } = useTenantMutations();
  const toast = useToast();
  const [type, setType] = useState(current ?? "");
  const [category, setCategory] = useState(currentCategory ?? "");
  useEffect(() => { setType(current ?? ""); }, [current]);
  useEffect(() => { setCategory(currentCategory ?? ""); }, [currentCategory]);

  const categories = (businessTypes.data ?? []).find((b) => b.code === type)?.categories ?? [];
  const dirty = type !== (current ?? "") || category !== (currentCategory ?? "");

  const save = () =>
    update.mutate(
      { id: tenantId, business_type: type, business_category: category || undefined },
      {
        onSuccess: () => toast.success("Business type updated"),
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't update business type."),
      },
    );

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <h3 className="font-semibold text-gray-800 dark:text-white/90">Business type &amp; category</h3>
      <p className="mb-3 text-theme-xs text-gray-400">Type drives features &amp; terminology (the owner can’t change it); the category refines it within the type.</p>
      <div className="grid grid-cols-2 gap-3">
        <Select
          value={type}
          options={(businessTypes.data ?? []).filter((b) => b.available).map((b) => ({ value: b.code, label: b.label }))}
          placeholder={businessTypes.isLoading ? "Loading…" : "Choose type"}
          onChange={(v) => { setType(v); setCategory(""); }}
        />
        <Select
          value={category}
          options={categories.map((c) => ({ value: c.value, label: c.label }))}
          placeholder={type ? "Choose a category" : "Pick a type first"}
          onChange={setCategory}
        />
      </div>
      <Button size="sm" className="mt-3" disabled={!dirty || !type || update.isPending} onClick={save}>
        {update.isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

/** Super-admin toggles which modules a tenant can access (its feature flags). */
function ModulesCard({ tenantId, features }: { tenantId: string; features: Record<string, boolean> }) {
  const catalog = useModuleCatalog();
  const save = useUpdateModules();
  const [state, setState] = useState<Record<string, boolean>>(features);

  useEffect(() => { setState(features); }, [features]);

  const dirty = (catalog.data ?? []).some((m) => (state[m.key] ?? false) !== (features[m.key] ?? false));

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold text-gray-800 dark:text-white/90">Modules</h3>
        {save.isSuccess && !dirty && <span className="text-theme-xs text-success-600">Saved ✓</span>}
      </div>
      <div className="space-y-3">
        {(catalog.data ?? []).map((m) => {
          const on = state[m.key] ?? false;
          return (
            <div key={m.key} className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-gray-800 dark:text-white/90">{m.label}</div>
                <div className="text-theme-xs text-gray-400">{m.description}</div>
              </div>
              <button
                type="button"
                onClick={() => setState((s) => ({ ...s, [m.key]: !on }))}
                className={`mt-0.5 h-6 w-11 shrink-0 rounded-full p-0.5 transition ${on ? "bg-brand-500" : "bg-gray-300 dark:bg-gray-700"}`}
              >
                <span className={`block h-5 w-5 rounded-full bg-white transition ${on ? "translate-x-5" : ""}`} />
              </button>
            </div>
          );
        })}
      </div>
      <Button size="sm" className="mt-4" disabled={!dirty || save.isPending} onClick={() => save.mutate({ id: tenantId, modules: state })}>
        {save.isPending ? "Saving…" : "Save modules"}
      </Button>
    </div>
  );
}

export default function AdminTenantDetailPage() {
  const { id } = useParams();
  const tenant = useAdminTenant(id);
  const plans = usePlans();
  const payments = usePayments({ tenant_id: id });
  const { suspend, activate, remove, restore, assignPlan } = useTenantMutations();

  const planModal = useModal();
  const toast = useToast();
  const confirm = useConfirm();
  const [planId, setPlanId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");

  const t = tenant.data;
  const paymentRows = payments.data?.data ?? [];
  const currentPlan = plans.data?.find((p) => p.id === t?.plan?.id);

  const onError = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Action failed.");
  const run = (fn: { mutate: (id: string, opts: object) => void }, success: string) => {
    if (!id) return;
    fn.mutate(id, { onSuccess: () => toast.success(success), onError });
  };

  const doDelete = async () => {
    const ok = await confirm({
      title: "Delete this tenant?",
      message: "Data is preserved and fully restorable — this is a soft delete.",
      confirmLabel: "Delete tenant",
      tone: "danger",
    });
    if (ok) run(remove, "Tenant deleted");
  };

  const doAssignPlan = () => {
    if (!id || !planId || assignPlan.isPending) return;
    assignPlan.mutate(
      {
        id,
        plan_id: planId,
        payment: amount ? { amount: Number(amount), method, reference: reference || undefined } : undefined,
      },
      {
        onSuccess: () => {
          toast.success("Plan assigned");
          planModal.closeModal();
        },
        onError,
      },
    );
  };

  if (tenant.isLoading || !t) {
    return <div className="h-64 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />;
  }

  return (
    <>
      <PageMeta title={`${t.business_name} | ShopOS Admin`} description="Tenant detail" />

      <div className="mb-6">
        <Link to="/admin/tenants" className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">← Back to tenants</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">{t.business_name}</h2>
          {t.deleted_at ? <Badge color="light">deleted</Badge>
            : t.status === "suspended" ? <Badge color="error">suspended</Badge>
            : <Badge color="success">active</Badge>}
          {t.online_shop_enabled && <Badge color="info">online shop</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Info + actions */}
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
            <h3 className="mb-4 font-semibold text-gray-800 dark:text-white/90">Business details</h3>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div><dt className="text-gray-400">City</dt><dd className="text-gray-700 dark:text-gray-300">{t.city?.name ?? "—"}</dd></div>
              <div><dt className="text-gray-400">Email</dt><dd className="text-gray-700 dark:text-gray-300">{t.email ?? "—"}</dd></div>
              <div><dt className="text-gray-400">Phone</dt><dd className="text-gray-700 dark:text-gray-300">{t.phone ?? "—"}</dd></div>
              <div><dt className="text-gray-400">Plan</dt><dd className="text-gray-700 dark:text-gray-300">{t.plan?.name ?? "No plan"}</dd></div>
              <div>
                <dt className="text-gray-400">Subscription</dt>
                <dd className="text-gray-700 dark:text-gray-300">
                  {t.subscription_ends_at ? `until ${new Date(t.subscription_ends_at).toLocaleDateString()}` : "—"}
                  {t.subscription_state === "grace" && <Badge size="sm" color="warning">grace</Badge>}
                  {t.subscription_state === "read_only" && <Badge size="sm" color="error">expired</Badge>}
                </dd>
              </div>
            </dl>
          </div>

          {/* Business type + category — admin-controlled */}
          <BusinessTypeCard tenantId={t.id} current={t.business_type ?? null} currentCategory={t.business_category ?? null} />

          {/* Module management */}
          <ModulesCard tenantId={t.id} features={t.features ?? {}} />

          {/* Plan usage & per-tenant limit extension */}
          <UsageLimitsCard tenant={t} plan={currentPlan} />

          {/* Owner accounts */}
          {t.users && t.users.length > 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
              <h3 className="mb-4 font-semibold text-gray-800 dark:text-white/90">Users</h3>
              <div className="space-y-2">
                {t.users.map((u) => (
                  <div key={u.id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 dark:text-gray-300">{u.name} <span className="text-gray-400">({u.email ?? u.phone})</span></span>
                    <Badge size="sm" color="light">{u.role}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Payment history */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
            <h3 className="mb-4 font-semibold text-gray-800 dark:text-white/90">Payment history</h3>
            {payments.isLoading ? (
              <div className="h-16 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
            ) : paymentRows.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">No payments recorded yet.</p>
            ) : (
              <table className="w-full text-left text-theme-sm">
                <thead>
                  <tr className="text-theme-xs text-gray-500 dark:text-gray-400">
                    <th className="pb-2 font-medium">Paid</th>
                    <th className="pb-2 font-medium">Plan</th>
                    <th className="pb-2 font-medium">Period</th>
                    <th className="pb-2 font-medium">Method</th>
                    <th className="pb-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {paymentRows.map((p) => (
                    <tr key={p.id} className="text-gray-700 dark:text-gray-300">
                      <td className="py-2">{new Date(p.paid_at).toLocaleDateString()}</td>
                      <td className="py-2">{p.plan_name}</td>
                      <td className="py-2 text-theme-xs text-gray-400">{p.period_start} → {p.period_end}</td>
                      <td className="py-2 capitalize">{p.method.replace("_", " ")}</td>
                      <td className="py-2 text-right font-medium">{money(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Actions sidebar */}
        <div className="h-fit space-y-3 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="mb-2 font-semibold text-gray-800 dark:text-white/90">Actions</h3>
          <Button size="sm" className="w-full" onClick={() => { setPlanId(t.plan?.id ?? ""); planModal.openModal(); }}>
            Assign / renew plan
          </Button>
          {t.deleted_at ? (
            <Button size="sm" variant="outline" className="w-full" onClick={() => run(restore, "Tenant restored")}>Restore</Button>
          ) : (
            <>
              {t.status === "active" ? (
                <Button size="sm" variant="outline" className="w-full" onClick={() => run(suspend, "Tenant suspended — all sessions revoked")} disabled={suspend.isPending}>Suspend</Button>
              ) : (
                <Button size="sm" variant="outline" className="w-full" onClick={() => run(activate, "Tenant activated")} disabled={activate.isPending}>Activate</Button>
              )}
              <button
                className="w-full rounded-lg border border-error-300 py-2.5 text-sm text-error-500 hover:bg-error-50 dark:border-error-500/40"
                onClick={doDelete}
              >
                Delete tenant
              </button>
            </>
          )}
        </div>
      </div>

      {/* Assign plan + optional payment */}
      <Modal isOpen={planModal.isOpen} onClose={planModal.closeModal} className="max-w-md p-6">
        <h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">Assign / renew plan</h3>
        <div className="space-y-4">
          <div>
            <Label>Plan</Label>
            <Select
              defaultValue={planId}
              options={(plans.data ?? []).map((p) => ({ value: p.id, label: `${p.name}${Number(p.price) > 0 ? ` — ${money(p.price)}` : ""}` }))}
              placeholder="Choose plan"
              onChange={setPlanId}
            />
          </div>
          <div className="border-t border-gray-200 pt-4 dark:border-gray-800">
            <p className="mb-3 text-theme-xs text-gray-400">Record payment (optional — leave amount blank for a free/complimentary assignment)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Amount</Label>
                <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
              </div>
              <div>
                <Label>Method</Label>
                <Select
                  options={[
                    { value: "cash", label: "Cash" },
                    { value: "bank_transfer", label: "Bank transfer" },
                    { value: "card", label: "Card" },
                    { value: "other", label: "Other" },
                  ]}
                  placeholder="Cash"
                  onChange={setMethod}
                />
              </div>
            </div>
            <div className="mt-3">
              <Label>Reference (optional)</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Txn / receipt no." />
            </div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={planModal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={doAssignPlan} disabled={assignPlan.isPending || !planId}>
            {assignPlan.isPending ? "Saving…" : "Assign plan"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
