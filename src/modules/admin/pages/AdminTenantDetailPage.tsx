import { useState } from "react";
import { Link, useParams } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Label from "../../../components/form/Label";
import Input from "../../../components/form/input/InputField";
import Select from "../../../components/form/Select";
import { Modal, ModalForm } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useToast } from "../../../components/ui/toast";
import { useConfirm } from "../../../components/ui/confirm";
import { ApiError } from "../../../common/types/api";
import { useAdminCities, useAdminTenant, useExtendLimits, useModuleCatalog, usePayments, usePlans, useResetOwnerPassword, useTenantMutations, useUpdateModules } from "../hooks/useAdmin";
import type { Plan } from "../services/adminService";
import { useBusinessTypes } from "../../shop/hooks/useShop";
import { useEffect } from "react";
import type { Tenant } from "../../auth/types";

const money = (n: string | number) => `Rs ${Number(n).toLocaleString()}`;

/**
 * The ceilings an admin can change here. `orders_month` is never capped, so it
 * isn't offered.
 *
 * Products and storage are what the PLAN meters — raising one extends this
 * shop past its plan. Branches, staff and lanes were assigned to the shop when
 * it was created and belong to it outright, which is why "give them a second
 * branch" is a number typed here and not a plan to go and buy.
 */
const EXTENDABLE: Array<{ key: "products" | "storage_mb" | "branches" | "staff" | "registers"; label: string }> = [
  { key: "products", label: "Products" },
  { key: "storage_mb", label: "Storage (MB)" },
  { key: "branches", label: "Branches" },
  { key: "staff", label: "Staff" },
  { key: "registers", label: "Checkout lanes" },
];

/**
 * Offline selling — the one switch that is a POLICY, not a ceiling.
 *
 * ── Why it needed its own card ──────────────────────────────────────────
 *
 * `offline_selling` has existed in PlanLimits for as long as the offline work
 * has. The server reads it, the till obeys it, the outbox refuses to sell
 * without it. **And no screen in this console could set it.** The limits modal
 * lists five countable ceilings — products, storage, branches, staff, lanes —
 * and this is not a number you extend, so it fell between them. The only way
 * to grant offline selling to a shop was to hand-write an HTTP request.
 *
 * Seventh time this codebase has produced the same shape: everything built,
 * nothing a person touches able to reach it.
 *
 * ── Why granting is deliberate and not a default ────────────────────────
 *
 * A till that sells offline prices the basket ITSELF. Until that engine has
 * been proved against a shop's OWN catalog — its packs, its promotions, its
 * tax groups — turning it on means trusting a second pricing implementation
 * with a real customer's money. Shadow mode runs that comparison on every
 * online sale, silently, and the shop's own Reports → Offline shows the
 * disagreements. This switch is what says the evidence has been read.
 *
 * ── Why revoking sends null and not 0 ───────────────────────────────────
 *
 * `extendLimits` refuses any value below 1 — a sane rule for a ceiling, where
 * zero products means a broken shop. A policy flag has no such floor, and
 * clearing to null falls back to the registry default, which is 0 = off. So
 * null IS the off switch here.
 */
function OfflineSellingCard({ tenant }: { tenant: Tenant }) {
  const extend = useExtendLimits();
  const toast = useToast();
  const granted = (tenant.limits?.offline_selling ?? 0) === 1;

  const set = (on: boolean) =>
    extend.mutate(
      { id: tenant.id, limits: { offline_selling: on ? 1 : null }, mode: "set" },
      {
        onSuccess: () =>
          toast.success(on ? "Offline selling granted." : "Offline selling withdrawn."),
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "That could not be changed."),
      },
    );

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-800 dark:text-white/90">Offline selling</h3>
          <p className="mt-1 max-w-xl text-theme-sm text-gray-500 dark:text-gray-400">
            Lets this shop keep trading through a dropped line. The till prices
            the basket itself while offline, so grant it only once the shop's
            pricing checks have run over its own sales and agree with the
            server.
          </p>
        </div>
        <Badge color={granted ? "success" : "light"}>{granted ? "Granted" : "Not granted"}</Badge>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={granted ? "outline" : "primary"}
          disabled={extend.isPending || granted}
          onClick={() => set(true)}
        >
          Grant offline selling
        </Button>
        {granted && (
          <Button size="sm" variant="danger" disabled={extend.isPending} onClick={() => set(false)}>
            Withdraw
          </Button>
        )}
      </div>

      <p className="mt-3 text-theme-xs text-gray-400">
        Everything else about offline needs no setup: a till registers itself,
        caches the catalog and runs the pricing comparison the first time the
        shop opens the POS. This switch is the only decision.
      </p>
    </div>
  );
}

/** Live usage vs this shop's effective ceilings, with an action to change them. */
function UsageLimitsCard({ tenant, plan }: { tenant: Tenant; plan?: Plan }) {
  const extend = useExtendLimits();
  const toast = useToast();
  const modal = useModal();
  const usage = tenant.limits_usage ?? [];
  const assigned = tenant.limits ?? {};

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
  const baseline = (key: string): number | null | undefined =>
    row(key)?.baseline ?? plan?.limits?.[key as keyof NonNullable<Plan["limits"]>];
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
        onSuccess: () => toast.success("Back to the inherited limit"),
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't clear it."),
      },
    );

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold text-gray-800 dark:text-white/90">Usage &amp; limits</h3>
        <Button size="sm" variant="outline" onClick={openExtend}>Change</Button>
      </div>

      {usage.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
          Nothing to meter yet.
        </p>
      ) : (
        <div className="space-y-4">
          {usage.map((u) => {
            const pct = u.limit && u.limit > 0 ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
            const bar = pct >= 100 ? "bg-error-500" : pct >= 80 ? "bg-warning-500" : "bg-brand-500";
            const extended = assigned[u.key] != null;
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
                      <Badge size="sm" color={u.owner === "tenant" ? "light" : extra < 0 ? "warning" : "info"}>
                        {u.owner === "tenant"
                          ? "assigned"
                          : extra > 0
                            ? `+${extra.toLocaleString()}`
                            : extra < 0
                              ? extra.toLocaleString()
                              : "custom"}
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
                    <span>
                      {u.owner === "plan" ? "Plan gives" : "Default is"} {fmt(u.baseline)}
                    </span>
                    <button
                      type="button"
                      onClick={() => clearOverride(u.key)}
                      className="text-brand-500 hover:text-brand-600"
                    >
                      {u.owner === "plan" ? "Reset to plan" : "Reset to default"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-md">
        <ModalForm
          title="Change limits"
          footer={
            <>
              <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={extend.isPending || anyBelowUsage}>
                {extend.isPending ? "Saving…" : "Save limits"}
              </Button>
            </>
          }
        >
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
                      <>Now {fmt(r?.limit)} · {r?.owner === "tenant" ? "default" : "plan"} {fmt(baseline(key))} · using {r?.used.toLocaleString() ?? 0}</>
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
        </ModalForm>
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

/**
 * Which modules this business has.
 *
 * The ONLY lever on a shop's capability. No plan grants or revokes one, so
 * nothing can undo what is set here except an admin setting it again — a
 * renewal used to, silently.
 */
function ModulesCard({ tenantId, features, defaults }: {
  tenantId: string;
  features: Record<string, boolean>;
  defaults?: Record<string, boolean>;
}) {
  const catalog = useModuleCatalog();
  const save = useUpdateModules();
  const [state, setState] = useState<Record<string, boolean>>(features);

  useEffect(() => { setState(features); }, [features]);

  const list = catalog.data ?? [];
  const dirty = list.some((m) => (state[m.key] ?? false) !== (features[m.key] ?? false));

  // Mirror of the server's Modules::normalize, so unticking Products visibly
  // takes everything built on it with it instead of saving a map that the
  // server then quietly rewrites.
  const toggle = (key: string, on: boolean) =>
    setState((prev) => {
      const map: Record<string, boolean> = {};
      list.forEach((m) => (map[m.key] = m.key === key ? on : (prev[m.key] ?? false)));
      if (map.marketplace) map.images = true;

      let changed = true;
      while (changed) {
        changed = false;
        list.forEach((m) => {
          if (map[m.key] && m.depends.some((d) => !map[d])) {
            map[m.key] = false;
            changed = true;
          }
        });
      }
      return map;
    });

  const groups: Record<string, typeof list> = {};
  list.forEach((m) => { (groups[m.group] ??= []).push(m); });

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-semibold text-gray-800 dark:text-white/90">Modules</h3>
        {save.isSuccess && !dirty && <span className="text-theme-xs text-success-600">Saved ✓</span>}
      </div>
      <p className="mb-4 text-theme-xs text-gray-400">
        What this business can do. Plans don't touch these.
      </p>

      <div className="space-y-5">
        {Object.entries(groups).map(([group, items]) => (
          <div key={group}>
            <p className="mb-2 text-theme-xs font-medium uppercase tracking-wide text-gray-400">{group}</p>
            <div className="space-y-3">
              {items.map((m) => {
                const on = state[m.key] ?? false;
                const blockedBy = m.depends.filter((d) => !state[d]);
                const differs = defaults !== undefined && on !== (defaults[m.key] ?? false);
                return (
                  <div key={m.key} className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-white/90">
                        {m.label}
                        {/* Whether this was a decision for this shop or just
                            what its trade usually gets. */}
                        {differs && <Badge size="sm" color="light">{on ? "granted" : "removed"}</Badge>}
                      </div>
                      <div className="text-theme-xs text-gray-400">
                        {blockedBy.length > 0 ? `Needs ${blockedBy.join(" and ")} switched on first.` : m.description}
                      </div>
                    </div>
                    <button
                      type="button"
                      // The module's name sits OUTSIDE this button, so the
                      // control itself announced as "button" and nothing else —
                      // twenty identical buttons down the module list with no
                      // way to hear which one you were on, or whether it was
                      // currently granted. The "granted/removed" badge only
                      // renders when the value differs from the trade default,
                      // so most rows had no state signal at all beyond the pill
                      // colour.
                      role="switch"
                      aria-checked={on}
                      aria-label={m.label}
                      disabled={blockedBy.length > 0}
                      onClick={() => toggle(m.key, !on)}
                      className={`mt-0.5 h-6 w-11 shrink-0 rounded-full p-0.5 transition ${
                        blockedBy.length > 0
                          ? "cursor-not-allowed bg-gray-200 opacity-50 dark:bg-gray-800"
                          : on
                            ? "bg-brand-500"
                            : "bg-gray-300 dark:bg-gray-700"
                      }`}
                    >
                      <span className={`block h-5 w-5 rounded-full bg-white transition ${on ? "translate-x-5" : ""}`} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <Button size="sm" className="mt-5" disabled={!dirty || save.isPending} onClick={() => save.mutate({ id: tenantId, modules: state })}>
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
  const { update, suspend, activate, remove, restore, assignPlan } = useTenantMutations();
  const resetPassword = useResetOwnerPassword();
  const cities = useAdminCities();
  const businessTypes = useBusinessTypes();

  const planModal = useModal();
  const editModal = useModal();
  const passwordModal = useModal();
  const [form, setForm] = useState({
    business_name: "", email: "", phone: "",
    business_type: "", business_category: "", city_id: "",
  });
  const toast = useToast();
  const confirm = useConfirm();
  const [planId, setPlanId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [pw, setPw] = useState({ password: "", confirm: "", user_id: "" });

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
        payment: amount
          ? {
              amount: Number(amount),
              method,
              reference: reference || undefined,
              paid_at: paidAt || undefined,
            }
          : undefined,
        // Sent only when the admin actually typed a date. An empty object here
        // would be indistinguishable from "no opinion" on the server side, and
        // this is the one field that must not be guessed at.
        period: startsAt || endsAt ? { starts_at: startsAt || undefined, ends_at: endsAt || undefined } : undefined,
      },
      {
        onSuccess: () => {
          toast.success("Plan assigned");
          planModal.closeModal();
          setStartsAt("");
          setEndsAt("");
          setPaidAt("");
        },
        onError,
      },
    );
  };

  /** Shop owners only — staff passwords are the owner's business, not ours. */
  const owners = (t?.users ?? []).filter((u) => u.role === "shop_owner");

  const doResetPassword = () => {
    if (!id || resetPassword.isPending) return;
    resetPassword.mutate(
      {
        id,
        password: pw.password,
        password_confirmation: pw.confirm,
        // Only sent when there is a genuine choice — the server refuses to
        // guess between two partners rather than picking the older row.
        user_id: owners.length > 1 ? pw.user_id || undefined : undefined,
      },
      {
        onSuccess: () => {
          toast.success("Password set. Every session that owner had is now signed out.");
          passwordModal.closeModal();
          setPw({ password: "", confirm: "", user_id: "" });
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
      <PageMeta title={`${t.business_name} | CartZe Admin`} description="Tenant detail" />

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
                  {/* Both ends of the window, not just the deadline: an admin
                      checking a renewal dispute needs to know what the last
                      payment bought, and "until 12/09" alone does not say. */}
                  {t.subscription_ends_at
                    ? `${t.subscription_starts_at ? `${new Date(t.subscription_starts_at).toLocaleDateString()} → ` : "until "}${new Date(t.subscription_ends_at).toLocaleDateString()}`
                    : "—"}
                  {t.subscription_state === "grace" && <Badge size="sm" color="warning">grace</Badge>}
                  {t.subscription_state === "read_only" && <Badge size="sm" color="error">expired</Badge>}
                </dd>
                {t.subscription_state === "grace" && t.grace_ends_at && (
                  <dd className="text-theme-xs text-warning-600 dark:text-warning-400">
                    Read-only from {new Date(t.grace_ends_at).toLocaleDateString()}
                  </dd>
                )}
              </div>
            </dl>
          </div>

          {/* Business type + category — admin-controlled */}
          <BusinessTypeCard tenantId={t.id} current={t.business_type ?? null} currentCategory={t.business_category ?? null} />

          {/* Module management */}
          <ModulesCard tenantId={t.id} features={t.features ?? {}} defaults={t.default_modules} />

          {/* Plan usage & per-tenant limit extension */}
          <UsageLimitsCard tenant={t} plan={currentPlan} />

          {/* The one policy switch — a grant, not a ceiling, so it is not in
              the limits modal. It had no screen at all until now. */}
          <OfflineSellingCard tenant={t} />

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
          {/* Editing a tenant had no UI at all: the API and the mutation both
              existed, nothing called them. A business created with a typo in
              its name — or with no plan picked — could not be corrected. */}
          <Button size="sm" variant="outline" className="w-full" onClick={() => {
            setForm({
              business_name: t.business_name ?? "",
              email: t.email ?? "",
              phone: t.phone ?? "",
              business_type: t.business_type ?? "",
              business_category: t.business_category ?? "",
              city_id: t.city?.id ?? "",
            });
            editModal.openModal();
          }}>
            Edit details
          </Button>
          <Button size="sm" className="w-full" onClick={() => { setPlanId(t.plan?.id ?? ""); planModal.openModal(); }}>
            Assign / renew plan
          </Button>
          {/* Account recovery. Until this existed, a shop owner who lost their
              email AND phone had no way back into their own business — the OTP
              reset needs one of them, so the only remaining option was a
              database console. */}
          {!t.deleted_at && owners.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => {
                setPw({ password: "", confirm: "", user_id: owners.length === 1 ? owners[0].id : "" });
                passwordModal.openModal();
              }}
            >
              Reset owner password
            </Button>
          )}
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
      {/* Edit business details */}
      <Modal isOpen={editModal.isOpen} onClose={editModal.closeModal} className="max-w-md">
        <ModalForm
          title="Edit business details"
          footer={
            <>
              <Button size="sm" variant="outline" onClick={editModal.closeModal}>Cancel</Button>
              <Button
                size="sm"
                disabled={update.isPending || !form.business_name.trim()}
                onClick={() => {
                  if (!id) return;
                  update.mutate(
                    {
                      id,
                      business_name: form.business_name.trim(),
                      // Empty strings would fail the email/uuid rules; the API
                      // takes null for "cleared".
                      email: form.email.trim() || null,
                      phone: form.phone.trim() || null,
                      business_type: form.business_type || undefined,
                      business_category: form.business_category || null,
                      city_id: form.city_id || null,
                    },
                    { onSuccess: () => { toast.success("Tenant updated"); editModal.closeModal(); }, onError },
                  );
                }}
              >
                {update.isPending ? "Saving…" : "Save changes"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div>
              <Label>Business name</Label>
              <Input value={form.business_name} onChange={(e) => setForm((f) => ({ ...f, business_name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Business type</Label>
              <Select
                value={form.business_type}
                options={(businessTypes.data ?? []).map((b) => ({ value: b.code, label: b.label }))}
                placeholder="Choose type"
                onChange={(v) => setForm((f) => ({ ...f, business_type: v, business_category: "" }))}
              />
              <p className="mt-1 text-theme-xs text-gray-400">
                Changing the type re-bases the module defaults. Anything already switched on stays on.
              </p>
            </div>
            <div>
              <Label>Category</Label>
              <Select
                value={form.business_category}
                options={((businessTypes.data ?? []).find((b) => b.code === form.business_type)?.categories ?? [])
                  .map((c) => ({ value: c.value, label: c.label }))}
                placeholder="Choose category"
                onChange={(v) => setForm((f) => ({ ...f, business_category: v }))}
              />
            </div>
            <div>
              <Label>City</Label>
              <Select
                value={form.city_id}
                options={(cities.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
                placeholder="Choose city"
                onChange={(v) => setForm((f) => ({ ...f, city_id: v }))}
              />
            </div>
          </div>
        </ModalForm>
      </Modal>

      <Modal isOpen={planModal.isOpen} onClose={planModal.closeModal} className="max-w-md">
        <ModalForm
          title="Assign / renew plan"
          footer={
            <>
              <Button size="sm" variant="outline" onClick={planModal.closeModal}>Cancel</Button>
              <Button size="sm" onClick={doAssignPlan} disabled={assignPlan.isPending || !planId}>
                {assignPlan.isPending ? "Saving…" : "Assign plan"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div>
              <Label>Plan</Label>
              <Select
                value={planId}
                options={(plans.data ?? []).map((p) => ({ value: p.id, label: `${p.name}${Number(p.price) > 0 ? ` — ${money(p.price)}` : ""}` }))}
                placeholder="Choose plan"
                onChange={setPlanId}
              />
              {(plans.data ?? []).length === 0 && (
                <p className="mt-1 text-theme-xs text-warning-600 dark:text-warning-400">
                  No plans exist yet — create one under Plans first.
                </p>
              )}
            </div>
            <div className="border-t border-gray-200 pt-4 dark:border-gray-800">
              <p className="mb-3 text-theme-xs text-gray-400">
                Billing period (optional — leave blank to run from today for the plan's period)
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>From</Label>
                  <Input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
                </div>
                <div>
                  <Label>To</Label>
                  <Input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
                </div>
              </div>
              <p className="mt-1 text-theme-xs text-gray-400">
                Renewing the same plan while it is still running stacks the new period onto the
                current end date, so paid days are never lost. Typing dates here overrides that.
              </p>
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
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <Label>Reference (optional)</Label>
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Txn / receipt no." />
                </div>
                <div>
                  {/* A shop that paid on Thursday and was entered on Monday
                      paid on Thursday. max: today — a payment in the future
                      has not happened. */}
                  <Label>Paid on</Label>
                  <Input
                    type="date"
                    value={paidAt}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setPaidAt(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        </ModalForm>
      </Modal>

      {/* Reset a shop owner's password */}
      <Modal isOpen={passwordModal.isOpen} onClose={passwordModal.closeModal} className="max-w-md">
        <ModalForm
          title="Reset owner password"
          footer={
            <>
              <Button size="sm" variant="outline" onClick={passwordModal.closeModal}>Cancel</Button>
              <Button
                size="sm"
                onClick={doResetPassword}
                disabled={
                  resetPassword.isPending ||
                  pw.password.length < 8 ||
                  pw.password !== pw.confirm ||
                  (owners.length > 1 && !pw.user_id)
                }
              >
                {resetPassword.isPending ? "Setting…" : "Set password"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="rounded-lg bg-warning-50 p-3 text-theme-xs text-warning-700 dark:bg-warning-500/10 dark:text-warning-400">
              This signs the owner out of every device immediately. Give them the new password
              yourself — it is never shown again after you close this box.
            </p>

            {owners.length > 1 && (
              <div>
                <Label>Which owner</Label>
                <Select
                  value={pw.user_id}
                  options={owners.map((u) => ({ value: u.id, label: `${u.name} (${u.email ?? u.phone})` }))}
                  placeholder="Choose owner"
                  onChange={(v) => setPw((p) => ({ ...p, user_id: v }))}
                />
              </div>
            )}
            {owners.length === 1 && (
              <p className="text-theme-sm text-gray-500 dark:text-gray-400">
                For <span className="font-medium text-gray-700 dark:text-gray-300">{owners[0].name}</span>
                {" "}({owners[0].email ?? owners[0].phone})
              </p>
            )}

            <div>
              <Label>New password</Label>
              <Input
                type="text"
                value={pw.password}
                onChange={(e) => setPw((p) => ({ ...p, password: e.target.value }))}
                placeholder="Min. 8 characters"
              />
            </div>
            <div>
              <Label>Type it again</Label>
              <Input
                type="text"
                value={pw.confirm}
                onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
                placeholder="Must match"
              />
              {/* The admin is about to read this down a phone line. A typo
                  here does not bounce back as "wrong password" the way their
                  own would — it locks the owner out a second time. */}
              {pw.confirm.length > 0 && pw.password !== pw.confirm && (
                <p className="mt-1 text-theme-xs text-error-500">These do not match.</p>
              )}
            </div>
          </div>
        </ModalForm>
      </Modal>
    </>
  );
}
