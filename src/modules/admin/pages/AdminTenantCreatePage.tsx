import { tradePhrase } from "../tradePhrase";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import { PlusIcon } from "../../../icons";
import { PageHeader } from "../components/kit";
import Label from "../../../components/form/Label";
import Input from "../../../components/form/input/InputField";
import Select from "../../../components/form/Select";
import Button from "../../../components/ui/button/Button";
import Alert from "../../../components/ui/alert/Alert";
import { ApiError } from "../../../common/types/api";
import { useAdminCities, useModuleCatalog, useModuleOffer, usePlans, useTenantMutations } from "../hooks/useAdmin";
import { useBusinessTypes } from "../../shop/hooks/useShop";
import { ModulePicker } from "../components/ModulePicker";
import { settle } from "../components/moduleRules";
import { toIsoDate } from "../../../components/ui/filters";

const money = (n: string | number) => `Rs ${Number(n).toLocaleString()}`;

/**
 * The three numbers a buyer asks about first — named once, because the
 * read-only summary and the override boxes have to agree about them.
 */
const SIZE_FIELDS = [
  { key: "branches", label: "Branches", hint: "The Main branch counts as one." },
  { key: "staff", label: "Staff accounts", hint: "The owner isn't counted." },
  { key: "registers", label: "Checkout lanes", hint: "A single-counter shop needs none." },
] as const;


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
    // Blank = whatever the chosen plan includes. Typing in one of these is
    // a deliberate exception for THIS shop, and the form says so.
    branches: "",
    staff: "",
    registers: "",
    owner_name: "",
    owner_email: "",
    owner_password: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Closed by default: an override is the exception, and a form that offers
  // one by default gets one by default.
  const [negotiated, setNegotiated] = useState(false);

  const [modules, setModules] = useState<Record<string, boolean>>({});
  // Once the admin has touched a checkbox the proposal stops overwriting their
  // work — switching type after that would otherwise throw it away silently.
  const [touchedModules, setTouchedModules] = useState(false);

  const types = businessTypes.data ?? [];
  const selectedType = types.find((t) => t.code === form.business_type);
  const typeCategories = selectedType?.categories ?? [];
  const moduleList = useMemo(() => catalog.data ?? [], [catalog.data]);

  // The type proposes; the admin disposes.
  // What the chosen plan gives a shop of the chosen trade, and what can be
  // added on top — the server's answer, asked again whenever either changes.
  const offer = useModuleOffer(form.business_type || undefined, form.plan_id || undefined);

  // The proposal follows the trade and the plan until somebody presses a
  // switch; after that the choice is theirs and a changed plan does not undo it.
  useEffect(() => {
    if (touchedModules || moduleList.length === 0 || !offer.data) return;
    setModules(settle(moduleList, offer.data.modules));
  }, [offer.data, touchedModules, moduleList]);

  // Once an admin has touched a switch, changing the business type must not
  // re-propose over the top of it — the type is a suggestion and this is a
  // decision.
  const chooseModules = (next: Record<string, boolean>) => {
    setTouchedModules(true);
    setModules(next);
  };

  const selectedPlan = (plans.data ?? []).find((p) => p.id === form.plan_id);

  // What one period comes to: the plan, and whatever was switched on past it.
  const addOns = (offer.data ? moduleList.filter((m) => modules[m.key] && !offer.data.included.includes(m.key)) : [])
    .map((m) => ({ key: m.key, label: m.label, monthly: offer.data?.prices[m.key] ?? 0 }));
  const months = selectedPlan?.billing_period_months ?? 1;
  const addOnsTotal = addOns.reduce((sum, a) => sum + a.monthly, 0) * months;
  const due = selectedPlan ? Number(selectedPlan.price) + addOnsTotal : 0;

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
        /**
         * ONLY WHAT WAS TYPED.
         *
         * This used to send all three every time, which wrote an override
         * onto every shop the moment it was created — so a shop "on Standard"
         * was really on a frozen copy of Standard's numbers, and raising the
         * plan later moved nothing. An untouched box now means "follow the
         * plan", for ever, including after an upgrade.
         */
        limits: Object.fromEntries(
          (["branches", "staff", "registers"] as const)
            .map((k) => [k, form[k].trim()])
            .filter(([, v]) => v !== "")
            .map(([k, v]) => [k, Number(v)]),
        ),
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
      <PageMeta title="Create Business" area="Admin" description="New business" />
      <Link to="/admin/tenants" className="mb-3 inline-block text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">
        ← Back to businesses
      </Link>
      <PageHeader
        icon={<PlusIcon />}
        tone="brand"
        title="Create a business"
        subtitle="Who it is, what it can do, how big it is, and what it pays — in the order the decisions are made."
      />

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

        <FormCard title="Plan" description="What this business pays, how much it may have, and the modules it starts with. Anything past the plan is an add-on for this one shop.">
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
                  {money(selectedPlan.price)} every {selectedPlan.billing_period_months ?? 1} month(s)
                </p>
                {/* The six numbers a buyer asks about, in the order they ask.
                    The summary used to lead with the product ceiling, which
                    nobody has ever rung up about. */}
                <p className="mt-1 text-gray-500 dark:text-gray-400">
                  {selectedPlan.limits?.branches ?? selectedPlan.defaults?.branches ?? 1} branches ·{" "}
                  {selectedPlan.limits?.staff ?? selectedPlan.defaults?.staff ?? 5} staff ·{" "}
                  {selectedPlan.limits?.registers ?? selectedPlan.defaults?.registers ?? 2} lanes
                </p>
                <p className="mt-1 text-gray-500 dark:text-gray-400">
                  {selectedPlan.limits?.orders_month == null
                    ? "Unlimited bills"
                    : `${selectedPlan.limits.orders_month.toLocaleString()} bills`} a month ·{" "}
                  {selectedPlan.limits?.retention_months == null
                    ? "history kept for good"
                    : `${selectedPlan.limits.retention_months} months of history`}{" "}
                  · {(selectedPlan.limits?.offline_selling ?? 0) > 0 ? "offline selling" : "no offline selling"}
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
                    placeholder={selectedPlan ? String(due) : "0"}
                  />
                  {/* The plan AND what was switched on past it — the figure a
                      person would otherwise have to add up from another card. */}
                  {selectedPlan && addOnsTotal > 0 && (
                    <p className="mt-1 text-theme-xs text-gray-400" data-testid="create-due">
                      {money(selectedPlan.price)} plan + {money(addOnsTotal)} add-ons = <span className="font-medium text-gray-600 dark:text-gray-300">{money(due)}</span>
                    </p>
                  )}
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
                    max={toIsoDate(new Date())}
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

        <FormCard
          title="Size of the business"
          description={selectedPlan
            ? `What ${selectedPlan.name} includes.`
            : "Pick a plan — it decides all three."}
        >
          {/* THE PLAN'S ANSWER, READ-ONLY.
              These were three empty boxes, and an empty box on a form is an
              invitation. The first version of this screen pre-filled them
              with 1 / 5 / 2 and sent all three every time, which wrote an
              override onto EVERY shop at the moment of creation — so a shop
              "on Standard" was really on a frozen copy of Standard's numbers
              and upgrading it later moved nothing.
              Blanking them fixed the sending and left the invitation. Now
              the plan simply states its answer, and typing over it is a
              separate, deliberate act below. */}
          <div className="grid grid-cols-3 gap-3">
            {SIZE_FIELDS.map(({ key, label }) => {
              const included = selectedPlan?.limits?.[key] ?? selectedPlan?.defaults?.[key] ?? null;
              const typed = form[key].trim();

              return (
                <div key={key} className="rounded-xl bg-gray-50 py-3 text-center dark:bg-white/[0.04]">
                  <p className="text-xl font-semibold tabular-nums text-gray-800 dark:text-white/90">
                    {typed !== "" ? typed : (included ?? "—")}
                  </p>
                  <p className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
                  {/* Only when it has been overridden, so the ordinary case
                      is three plain numbers and nothing to read. */}
                  {typed !== "" && String(included) !== typed && (
                    <p className="mt-0.5 text-theme-xs text-warning-600 dark:text-warning-400">
                      plan gives {included ?? "—"}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={negotiated}
              onChange={(e) => {
                setNegotiated(e.target.checked);
                // Closing it CLEARS what was typed. A hidden override is the
                // exact thing this card exists to prevent: an admin who
                // changed their mind must not leave a number behind that no
                // longer appears anywhere on the form.
                if (!e.target.checked) {
                  setForm((f) => ({ ...f, branches: "", staff: "", registers: "" }));
                }
              }}
            />
            <span>
              <span className="font-medium">This business negotiated something different</span>
              <span className="block text-theme-xs text-gray-400">
                Rare. A number set here beats the plan permanently — including after an upgrade — so it is
                for a deal that really is different, not for a shop that is merely bigger.
              </span>
            </span>
          </label>

          {negotiated && (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {SIZE_FIELDS.map(({ key, label, hint }) => {
                const included = selectedPlan?.limits?.[key] ?? selectedPlan?.defaults?.[key] ?? null;

                return (
                  <div key={key}>
                    <Label>{label}</Label>
                    <Input
                      type="number"
                      min="1"
                      value={form[key]}
                      onChange={(e) => set(key, e.target.value)}
                      placeholder={included === null ? "" : String(included)}
                    />
                    <p className="mt-1 text-theme-xs text-gray-400">
                      {form[key].trim() === "" ? hint : `The plan includes ${included ?? "—"}.`}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
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
            ? selectedPlan
              ? `What ${selectedPlan.name} gives ${tradePhrase(form.business_type, selectedType?.label)}, and what can be added for this one. Only what this trade can use is shown.`
              : `Only what ${tradePhrase(form.business_type, selectedType?.label)} can use. Choose a plan to see what it includes.`
            : "Pick a business type and a plan — what the plan includes appears here."}
        >
          {!form.business_type ? (
            <p className="py-6 text-center text-theme-sm text-gray-400">Choose a business type first.</p>
          ) : (
            <ModulePicker
              catalog={moduleList}
              value={modules}
              onChange={chooseModules}
              offer={offer.data}
              prices={offer.data?.prices}
              planName={selectedPlan?.name ?? null}
              tradeLabel={form.business_type ? tradePhrase(form.business_type, selectedType?.label) : null}
              emptyHint="Choose a business type first."
            />
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
              <Button type="submit" size="sm" disabled={create.isPending || !ready}>
                {create.isPending ? "Creating…" : "Create business"}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </>
  );
}
