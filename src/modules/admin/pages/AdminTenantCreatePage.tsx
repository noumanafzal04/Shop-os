import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import Label from "../../../components/form/Label";
import Input from "../../../components/form/input/InputField";
import Select from "../../../components/form/Select";
import Button from "../../../components/ui/button/Button";
import Alert from "../../../components/ui/alert/Alert";
import { ApiError } from "../../../common/types/api";
import { useAdminCities, useModuleCatalog, usePlans, useTenantMutations } from "../hooks/useAdmin";
import { useBusinessTypes } from "../../shop/hooks/useShop";
import type { ModuleInfo } from "../services/adminService";

const money = (n: string | number) => `Rs ${Number(n).toLocaleString()}`;

/**
 * Mirror of the server's Modules::normalize — a module whose dependency is off
 * cannot be left on, and selling online forces photos on. Running it here means
 * the admin sees the consequence of unticking Products as they do it, rather
 * than discovering it after saving.
 */
function normalize(modules: Record<string, boolean>, catalog: ModuleInfo[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  catalog.forEach((m) => (map[m.key] = modules[m.key] ?? false));

  if (map.marketplace) map.images = true;

  let changed = true;
  while (changed) {
    changed = false;
    catalog.forEach((m) => {
      if (!map[m.key]) return;
      if (m.depends.some((d) => !map[d])) {
        map[m.key] = false;
        changed = true;
      }
    });
  }
  return map;
}

/**
 * Creating a business, in the order the decisions actually happen.
 *
 *   ① Who it is           name, type, city
 *   ② What it can do      the modules it is given — proposed by its type
 *   ③ How big it is       branches, staff, checkout lanes
 *   ④ What it pays        the plan
 *
 * ②, ③ and ④ are independent on purpose. A plan used to carry the module list,
 * which meant every combination needed a plan of its own and a renewal could
 * silently revoke a module an admin had granted. Now a plan decides only price
 * and catalog ceiling, and everything a shop can DO is decided right here.
 */
/**
 * One topic of the form.
 *
 * The page was a single 3xl column down the middle of an admin's widescreen,
 * which is five sections of scrolling to create one business — with the tall
 * one (Modules, which grows with the trade) in the middle of the run, pushing
 * the owner's account off the bottom.
 */
function FormCard({ title, description, children, className = "" }: {
  title: string; description?: string; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6 ${className}`}>
      <header className="mb-5">
        <h3 className="font-semibold text-gray-800 dark:text-white/90">{title}</h3>
        {description && <p className="mt-0.5 text-theme-sm text-gray-500 dark:text-gray-400">{description}</p>}
      </header>
      {children}
    </section>
  );
}

export default function AdminTenantCreatePage() {
  const navigate = useNavigate();
  const cities = useAdminCities();
  const plans = usePlans();
  const businessTypes = useBusinessTypes();
  const catalog = useModuleCatalog();
  const { create } = useTenantMutations();

  const [form, setForm] = useState({
    business_name: "",
    email: "",
    phone: "",
    business_type: "",
    business_category: "",
    city_id: "",
    plan_id: "",
    // The subscription window. Blank = starts today and runs for the plan's
    // billing period, which is right for a shop signing up now and wrong for
    // every shop migrating on mid-cycle.
    period_starts_at: "",
    period_ends_at: "",
    // The opening payment, if one was taken at signup.
    payment_amount: "",
    payment_method: "cash",
    payment_reference: "",
    payment_paid_at: "",
    branches: "1",
    staff: "5",
    registers: "2",
    owner_name: "",
    owner_email: "",
    owner_password: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const [modules, setModules] = useState<Record<string, boolean>>({});
  // Once the admin has touched a checkbox the proposal stops overwriting their
  // work — switching type after that would otherwise throw it away silently.
  const [touchedModules, setTouchedModules] = useState(false);

  const types = businessTypes.data ?? [];
  const selectedType = types.find((t) => t.code === form.business_type);
  const typeCategories = selectedType?.categories ?? [];
  const moduleList = useMemo(() => catalog.data ?? [], [catalog.data]);

  // The type proposes; the admin disposes.
  useEffect(() => {
    if (!selectedType || touchedModules || moduleList.length === 0) return;
    setModules(normalize(selectedType.default_modules ?? {}, moduleList));
  }, [selectedType, touchedModules, moduleList]);

  const toggleModule = (key: string, on: boolean) => {
    setTouchedModules(true);
    setModules((m) => normalize({ ...m, [key]: on }, moduleList));
  };

  const groups = useMemo(() => {
    const out: Record<string, ModuleInfo[]> = {};
    moduleList.forEach((m) => {
      (out[m.group] ??= []).push(m);
    });
    return out;
  }, [moduleList]);

  const selectedPlan = (plans.data ?? []).find((p) => p.id === form.plan_id);

  const apiError = create.error instanceof ApiError ? create.error : null;
  const errorFor = (k: string) => apiError?.errors[k]?.[0];
  const generalError = apiError && Object.keys(apiError.errors).length === 0 ? apiError.message : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (create.isPending) return;
    create.mutate(
      {
        business_name: form.business_name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        business_type: form.business_type,
        business_category: form.business_category || undefined,
        city_id: form.city_id || undefined,
        plan_id: form.plan_id,
        // Sent only when the admin typed something. An empty period object is
        // indistinguishable from "no opinion" server-side, and this is the one
        // field that must not be guessed at — every later renewal stacks onto
        // whatever is recorded here.
        period:
          form.period_starts_at || form.period_ends_at
            ? {
                starts_at: form.period_starts_at || undefined,
                ends_at: form.period_ends_at || undefined,
              }
            : undefined,
        payment: form.payment_amount
          ? {
              amount: Number(form.payment_amount),
              method: form.payment_method,
              reference: form.payment_reference.trim() || undefined,
              paid_at: form.payment_paid_at || undefined,
            }
          : undefined,
        modules,
        limits: {
          branches: Number(form.branches) || 1,
          staff: Number(form.staff) || 1,
          registers: Number(form.registers) || 1,
        },
        owner: {
          name: form.owner_name.trim(),
          email: form.owner_email.trim() || undefined,
          password: form.owner_password,
        },
      },
      { onSuccess: ({ data }) => navigate(`/admin/tenants/${data.id}`) },
    );
  };

  // Naming what is still missing rather than only greying the button out. A
  // disabled Create on a form five sections long is a dead end: the one empty
  // field is usually off screen, and there is nothing to tell you which.
  const missing = [
    form.business_name.trim() === "" && "business name",
    form.business_type === "" && "business type",
    form.plan_id === "" && "plan",
    form.owner_name.trim() === "" && "owner name",
    form.owner_email.trim() === "" && "owner email",
    form.owner_password === "" && "temp password",
  ].filter(Boolean) as string[];
  const ready = missing.length === 0;

  return (
    <>
      <PageMeta title="Create Business | ShopOS Admin" description="New business" />
      <div className="mb-6">
        <Link to="/admin/tenants" className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">
          ← Back to businesses
        </Link>
        <h2 className="mt-1 text-xl font-semibold text-gray-800 dark:text-white/90">Create a business</h2>
      </div>

      {generalError && (
        <div className="mb-5">
          <Alert variant="error" title="Couldn't create" message={generalError} />
        </div>
      )}

      {/* Two columns: the shop's own details down the left, and the module
          picker — the one section whose height depends on the trade — kept
          beside them rather than wedged between them. */}
      <form onSubmit={submit}>
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
        <FormCard title="Business" description="Who this shop is, and how the platform reaches them.">
          <div className="space-y-4">
            <div>
              <Label>Business name <span className="text-error-500">*</span></Label>
              <Input value={form.business_name} onChange={(e) => set("business_name", e.target.value)} />
              {errorFor("business_name") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("business_name")}</p>}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label>Business type <span className="text-error-500">*</span></Label>
                <Select
                  value={form.business_type}
                  options={types.filter((t) => t.available).map((t) => ({ value: t.code, label: t.label }))}
                  placeholder={businessTypes.isLoading ? "Loading…" : "Choose the business type"}
                  onChange={(v) => setForm((f) => ({ ...f, business_type: v, business_category: "" }))}
                />
                {errorFor("business_type") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("business_type")}</p>}
              </div>
              <div>
                <Label>Category</Label>
                <Select
                  value={form.business_category}
                  options={typeCategories.map((c) => ({ value: c.value, label: c.label }))}
                  placeholder={form.business_type ? "Choose a category" : "Pick a type first"}
                  onChange={(v) => set("business_category", v)}
                />
              </div>
            </div>
            <p className="-mt-2 text-theme-xs text-gray-400">
              The type drives terminology, default categories and the modules proposed below. The owner can't change it.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
                {errorFor("email") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("email")}</p>}
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
                {errorFor("phone") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("phone")}</p>}
              </div>
              <div>
                <Label>City</Label>
                <Select
                  value={form.city_id}
                  options={[{ value: "", label: "—" }, ...(cities.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
                  placeholder="—"
                  onChange={(v) => set("city_id", v)}
                />
              </div>
            </div>
          </div>
        </FormCard>

        <FormCard title="Size of the business" description="Assigned to this business, not bought with a plan — so a second branch is a number you raise here, any time.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label>Branches</Label>
              <Input type="number" min="1" value={form.branches} onChange={(e) => set("branches", e.target.value)} />
              <p className="mt-1 text-theme-xs text-gray-400">The Main branch counts as one.</p>
            </div>
            <div>
              <Label>Staff accounts</Label>
              <Input type="number" min="1" value={form.staff} onChange={(e) => set("staff", e.target.value)} />
              <p className="mt-1 text-theme-xs text-gray-400">The owner isn't counted.</p>
            </div>
            <div>
              <Label>Checkout lanes</Label>
              <Input type="number" min="1" value={form.registers} onChange={(e) => set("registers", e.target.value)} />
              <p className="mt-1 text-theme-xs text-gray-400">A single-counter shop needs none.</p>
            </div>
          </div>
        </FormCard>

        <FormCard title="Plan" description="Price, billing period and the catalog ceiling. It grants no modules.">
          <div className="space-y-4">
            <div>
              <Label>Plan <span className="text-error-500">*</span></Label>
              <Select
                value={form.plan_id}
                options={(plans.data ?? [])
                  .filter((p) => p.is_active !== false)
                  .map((p) => ({ value: p.id, label: `${p.name} — ${money(p.price)}` }))}
                placeholder={plans.isLoading ? "Loading…" : "Choose a plan"}
                onChange={(v) => set("plan_id", v)}
              />
              {errorFor("plan_id") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("plan_id")}</p>}
            </div>
            {selectedPlan && (
              <div className="rounded-lg bg-gray-50 p-3 text-theme-xs dark:bg-white/[0.04]">
                <p className="mb-1 font-medium text-gray-700 dark:text-gray-200">{selectedPlan.name}</p>
                <p className="text-gray-500 dark:text-gray-400">
                  {money(selectedPlan.price)} every {selectedPlan.billing_period_months ?? 1} month(s) ·{" "}
                  {selectedPlan.limits?.products == null
                    ? "unlimited products"
                    : `${selectedPlan.limits.products.toLocaleString()} products`}{" "}
                  · {selectedPlan.grace_period_days ?? 7}-day grace
                </p>
              </div>
            )}

            {/* The billing window and the opening payment.
                This is the only moment the renewal anchor can be set
                correctly: every later period stacks onto whatever is recorded
                here, so a shop that joined mid-cycle and was entered as
                "starts today" has the wrong renewal date forever. */}
            <div className="border-t border-gray-200 pt-4 dark:border-gray-800">
              <p className="mb-3 text-theme-xs text-gray-400">
                Billing period — leave blank to run from today for the plan's period
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>From</Label>
                  <Input
                    type="date"
                    value={form.period_starts_at}
                    onChange={(e) => set("period_starts_at", e.target.value)}
                  />
                </div>
                <div>
                  <Label>To</Label>
                  <Input
                    type="date"
                    value={form.period_ends_at}
                    onChange={(e) => set("period_ends_at", e.target.value)}
                  />
                  {errorFor("period.ends_at") && (
                    <p className="mt-1 text-theme-xs text-error-500">{errorFor("period.ends_at")}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-4 dark:border-gray-800">
              <p className="mb-3 text-theme-xs text-gray-400">
                Opening payment — leave the amount blank if nothing was taken yet
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Amount</Label>
                  <Input
                    type="number"
                    min="0"
                    value={form.payment_amount}
                    onChange={(e) => set("payment_amount", e.target.value)}
                    placeholder={selectedPlan ? String(selectedPlan.price) : "0"}
                  />
                </div>
                <div>
                  <Label>Method</Label>
                  <Select
                    value={form.payment_method}
                    options={[
                      { value: "cash", label: "Cash" },
                      { value: "bank_transfer", label: "Bank transfer" },
                      { value: "card", label: "Card" },
                      { value: "other", label: "Other" },
                    ]}
                    placeholder="Cash"
                    onChange={(v) => set("payment_method", v)}
                  />
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <Label>Reference</Label>
                  <Input
                    value={form.payment_reference}
                    onChange={(e) => set("payment_reference", e.target.value)}
                    placeholder="Txn / receipt no."
                  />
                </div>
                <div>
                  {/* Paid Thursday, entered Monday: the ledger says Thursday.
                      Capped at today because a payment in the future has not
                      happened. */}
                  <Label>Paid on</Label>
                  <Input
                    type="date"
                    value={form.payment_paid_at}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => set("payment_paid_at", e.target.value)}
                  />
                  {errorFor("payment.paid_at") && (
                    <p className="mt-1 text-theme-xs text-error-500">{errorFor("payment.paid_at")}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </FormCard>

        <FormCard title="Owner account" description="The first login. They set their own password afterwards.">
          <div className="space-y-4">
            <div>
              <Label>Owner name <span className="text-error-500">*</span></Label>
              <Input value={form.owner_name} onChange={(e) => set("owner_name", e.target.value)} />
              {errorFor("owner.name") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("owner.name")}</p>}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label>Owner email <span className="text-error-500">*</span></Label>
                <Input type="email" value={form.owner_email} onChange={(e) => set("owner_email", e.target.value)} />
                {errorFor("owner.email") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("owner.email")}</p>}
              </div>
              <div>
                <Label>Temp password <span className="text-error-500">*</span></Label>
                <Input type="text" value={form.owner_password} onChange={(e) => set("owner_password", e.target.value)} placeholder="Min. 8 chars" />
                {errorFor("owner.password") && <p className="mt-1 text-theme-xs text-error-500">{errorFor("owner.password")}</p>}
              </div>
            </div>
          </div>
        </FormCard>
        </div>

        {/* Right column — the module picker on its own, because its height is
            the one thing on this form the admin cannot predict. */}
        <FormCard
          title="Modules"
          description={form.business_type
            ? `Proposed for a ${selectedType?.label.toLowerCase()} — adjust anything. Nothing on a plan can change these later.`
            : "Pick a business type and its usual modules appear here."}
        >
          {!form.business_type ? (
            <p className="py-6 text-center text-theme-sm text-gray-400">Choose a business type first.</p>
          ) : (
            <div className="space-y-5">
              {Object.entries(groups).map(([group, items]) => (
                <div key={group}>
                  <p className="mb-2 text-theme-xs font-medium uppercase tracking-wide text-gray-400">{group}</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {items.map((m) => {
                      const blockedBy = m.depends.filter((d) => !modules[d]);
                      const disabled = blockedBy.length > 0;
                      return (
                        <label
                          key={m.key}
                          className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-sm transition ${
                            disabled
                              ? "cursor-not-allowed border-gray-100 opacity-50 dark:border-gray-800"
                              : modules[m.key]
                                ? "cursor-pointer border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                                : "cursor-pointer border-gray-200 hover:border-gray-300 dark:border-gray-700"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 shrink-0"
                            checked={modules[m.key] ?? false}
                            disabled={disabled}
                            onChange={(e) => toggleModule(m.key, e.target.checked)}
                          />
                          <span className="min-w-0">
                            <span className="font-medium text-gray-800 dark:text-white/90">{m.label}</span>
                            <span className="block text-theme-xs text-gray-500 dark:text-gray-400">
                              {disabled ? `Needs ${blockedBy.join(" and ")} switched on first.` : m.description}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </FormCard>
        </div>

        {/* The button follows you down a form this long, and says what is still
            missing — a disabled Create with the empty field off screen is a
            dead end. */}
        <div className="sticky bottom-0 z-30 -mx-4 mt-5 border-t border-gray-200 bg-white/90 px-4 py-3 backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/90 md:-mx-6 md:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`text-theme-xs ${ready ? "text-success-600 dark:text-success-500" : "text-gray-500 dark:text-gray-400"}`}>
              {ready ? "Ready to create." : `Still needed: ${missing.join(", ")}.`}
            </span>
            <div className="ml-auto flex gap-3">
              <Link to="/admin/tenants"><Button type="button" size="sm" variant="outline">Cancel</Button></Link>
              <Button size="sm" disabled={create.isPending || !ready}>
                {create.isPending ? "Creating…" : "Create business"}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </>
  );
}
