import { useState } from "react";
import { Link, useParams } from "react-router";
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
import { useAdminTenant, useModuleCatalog, usePayments, usePlans, useTenantMutations, useUpdateModules } from "../hooks/useAdmin";
import { useBusinessTypes } from "../../shop/hooks/useShop";
import { useEffect } from "react";

const money = (n: string | number) => `Rs ${Number(n).toLocaleString()}`;

/** Admin-only editor for a tenant's business type (owners can't change it). */
function BusinessTypeCard({ tenantId, current }: { tenantId: string; current: string | null }) {
  const businessTypes = useBusinessTypes();
  const { update } = useTenantMutations();
  const [value, setValue] = useState(current ?? "");
  useEffect(() => { setValue(current ?? ""); }, [current]);
  const dirty = value !== (current ?? "");

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-semibold text-gray-800 dark:text-white/90">Business type</h3>
        {update.isSuccess && !dirty && <span className="text-theme-xs text-success-600">Saved ✓</span>}
      </div>
      <p className="mb-3 text-theme-xs text-gray-400">Drives features, default categories and terminology. Only you (admin) can change this — the owner can't.</p>
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Select
            value={value}
            options={(businessTypes.data ?? []).filter((b) => b.available).map((b) => ({ value: b.code, label: b.label }))}
            placeholder={businessTypes.isLoading ? "Loading…" : "Choose type"}
            onChange={setValue}
          />
        </div>
        <Button size="sm" disabled={!dirty || !value || update.isPending} onClick={() => update.mutate({ id: tenantId, business_type: value })}>
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
      {update.error instanceof ApiError && <p className="mt-2 text-theme-xs text-error-500">{update.error.message}</p>}
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
  const [planId, setPlanId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const t = tenant.data;
  const paymentRows = payments.data?.data ?? [];

  const onError = (e: unknown) => setActionError(e instanceof ApiError ? e.message : "Action failed.");
  const run = (fn: { mutate: (id: string, opts: object) => void }) => {
    if (!id) return;
    setActionError(null);
    fn.mutate(id, { onError });
  };

  const doAssignPlan = () => {
    if (!id || !planId || assignPlan.isPending) return;
    assignPlan.mutate(
      {
        id,
        plan_id: planId,
        payment: amount ? { amount: Number(amount), method, reference: reference || undefined } : undefined,
      },
      { onSuccess: () => planModal.closeModal(), onError },
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

      {actionError && <div className="mb-4"><Alert variant="error" title="Action blocked" message={actionError} /></div>}

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

          {/* Business type — admin-controlled */}
          <BusinessTypeCard tenantId={t.id} current={t.business_type ?? null} />

          {/* Module management */}
          <ModulesCard tenantId={t.id} features={t.features ?? {}} />

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
          <Button size="sm" className="w-full" onClick={() => { setPlanId(t.plan?.id ?? ""); setActionError(null); planModal.openModal(); }}>
            Assign / renew plan
          </Button>
          {t.deleted_at ? (
            <Button size="sm" variant="outline" className="w-full" onClick={() => run(restore)}>Restore</Button>
          ) : (
            <>
              {t.status === "active" ? (
                <Button size="sm" variant="outline" className="w-full" onClick={() => run(suspend)} disabled={suspend.isPending}>Suspend</Button>
              ) : (
                <Button size="sm" variant="outline" className="w-full" onClick={() => run(activate)} disabled={activate.isPending}>Activate</Button>
              )}
              <button
                className="w-full rounded-lg border border-error-300 py-2.5 text-sm text-error-500 hover:bg-error-50 dark:border-error-500/40"
                onClick={() => { if (window.confirm("Soft-delete this tenant? Data is preserved and restorable.")) run(remove); }}
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
