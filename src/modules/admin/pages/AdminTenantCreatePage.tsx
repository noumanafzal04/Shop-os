import { useEffect, useMemo, useState, type FormEvent } from "react";
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

  const ready =
    form.business_name.trim() !== "" &&
    form.business_type !== "" &&
    form.plan_id !== "" &&
    form.owner_name.trim() !== "" &&
    form.owner_email.trim() !== "" &&
    form.owner_password !== "";

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
        <div className="mb-5 max-w-3xl">
          <Alert variant="error" title="Couldn't create" message={generalError} />
        </div>
      )}

      <form onSubmit={submit} className="max-w-3xl space-y-6">
        {/* ① Who it is ───────────────────────────────────────────── */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="mb-4 font-semibold text-gray-800 dark:text-white/90">Business</h3>
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
        </section>

        {/* ② What it can do ──────────────────────────────────────── */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="mb-4">
            <h3 className="font-semibold text-gray-800 dark:text-white/90">Modules</h3>
            <p className="text-theme-xs text-gray-500 dark:text-gray-400">
              {form.business_type
                ? `Proposed for a ${selectedType?.label.toLowerCase()} — adjust anything. Nothing on a plan can change these later.`
                : "Pick a business type and its usual modules appear here."}
            </p>
          </div>

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
        </section>

        {/* ③ How big it is ───────────────────────────────────────── */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="mb-4">
            <h3 className="font-semibold text-gray-800 dark:text-white/90">Size of the business</h3>
            <p className="text-theme-xs text-gray-500 dark:text-gray-400">
              Assigned to this business, not bought with a plan — so a second branch is a number you raise here,
              any time.
            </p>
          </div>
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
        </section>

        {/* ④ What it pays ────────────────────────────────────────── */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="mb-4">
            <h3 className="font-semibold text-gray-800 dark:text-white/90">Plan</h3>
            <p className="text-theme-xs text-gray-500 dark:text-gray-400">
              Price, billing period and the catalog ceiling. It grants no modules.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          </div>
        </section>

        {/* Owner ─────────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="mb-4 font-semibold text-gray-800 dark:text-white/90">Owner account</h3>
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
        </section>

        <div className="flex gap-3">
          <Button size="sm" disabled={create.isPending || !ready}>
            {create.isPending ? "Creating…" : "Create business"}
          </Button>
          <Link to="/admin/tenants"><Button size="sm" variant="outline">Cancel</Button></Link>
        </div>
      </form>
    </>
  );
}
