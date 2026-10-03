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
import { ROW_ACTION, ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";

const money = (n: string | number) => `Rs ${Number(n).toLocaleString()}`;
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const fmtLimit = (n: number | null | undefined) => (n == null ? "Unlimited" : n.toLocaleString());
const fmtStorage = (mb: number | null | undefined) =>
  mb == null ? "Unlimited" : mb >= 1024 ? `${(mb / 1024).toLocaleString()} GB` : `${mb} MB`;

/**
 * Months, said the way a person says them.
 *
 * Stored in months so "eighteen months" is a real offer; printed in years
 * wherever it divides, because nobody sells "sixty months of history".
 */
const fmtMonths = (m: number | null | undefined) =>
  m == null
    ? "Kept for good"
    : m % 12 === 0
      ? `${m / 12} year${m === 12 ? "" : "s"}`
      : `${m} months`;

const blank = {
  name: "",
  code: "",
  description: "",
  price: "0",
  billing_period_months: "1",
  grace_period_days: "7",
  // Ceilings — blank string = unlimited.
  products: "",
  storage_mb: "",
  orders_month: "",
  grace_orders_month: "",
  retention_months: "",
  // Organisation size. Blank here does NOT mean unlimited — see the note in
  // the form. It means the platform default.
  branches: "",
  staff: "",
  registers: "",
  offline_selling: false,
  offline_days: "",
  is_active: true,
  is_custom: false,
};

/**
 * Plans.
 *
 * A plan is a price and a set of ceilings. It grants NO MODULES, and that is
 * the whole reason this list stays short: a petrol pump, a restaurant and a
 * books-only office can all sit on Basic and still each run exactly what their
 * trade needs. Plans carried a module map once, so the list was really the 2³
 * combinations of POS × Expenses × Online, and every new sellable module would
 * have doubled it.
 *
 * ── Capability and capacity are different questions ────────────────────
 *
 *   What a shop may DO    modules, per shop, never on a plan.
 *   How MUCH it may have  branches, staff, tills, bills, history. Here.
 *
 * Branches and staff used to be in neither place — assigned by hand, one shop
 * at a time — so Basic and Enterprise granted identical organisations until
 * somebody remembered to type otherwise, and the ladder being sold existed
 * only in a salesperson's head.
 *
 * The one crossing is offline selling. It is a capability and it sits on the
 * plan anyway, because a module describes the SHAPE of a trade — a pharmacy
 * has no use for a kitchen docket — while offline selling is wanted by every
 * shop in the country and costs real money to support. That makes it a rung,
 * not a shape.
 */
export default function AdminPlansPage() {
  const plans = usePlans();
  const { create, update, remove } = usePlanMutations();
  const modal = useModal();
  const toast = useToast();
  const confirm = useConfirm();

  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState({ ...blank });
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = editing ? update : create;
  const apiError = mutation.error instanceof ApiError ? mutation.error : null;
  const errorFor = (k: string) => apiError?.errors[k]?.[0];
  const toastGeneralError = (e: unknown) => {
    if (e instanceof ApiError && Object.keys(e.errors).length > 0) return; // inline handles it
    toast.error(e instanceof ApiError ? e.message : "Couldn't save plan.");
  };

  const openCreate = (custom = false) => {
    setEditing(null);
    setForm({ ...blank, is_custom: custom, billing_period_months: custom ? "12" : "1" });
    create.reset();
    modal.openModal();
  };

  const openEdit = (plan: Plan) => {
    setEditing(plan);
    const lim = plan.limits;
    const str = (n: number | null | undefined) => (n == null ? "" : String(n));
    setForm({
      name: plan.name,
      code: plan.code,
      description: plan.description ?? "",
      price: String(plan.price),
      billing_period_months: String(plan.billing_period_months ?? 1),
      grace_period_days: String(plan.grace_period_days ?? 7),
      products: str(lim?.products),
      storage_mb: str(lim?.storage_mb),
      orders_month: str(lim?.orders_month),
      grace_orders_month: str(plan.grace_orders_month),
      retention_months: str(lim?.retention_months),
      branches: str(lim?.branches),
      staff: str(lim?.staff),
      registers: str(lim?.registers),
      offline_selling: (lim?.offline_selling ?? 0) > 0,
      offline_days: str(lim?.offline_days),
      is_active: plan.is_active ?? true,
      is_custom: plan.is_custom ?? false,
    });
    update.reset();
    modal.openModal();
  };

  const submit = () => {
    const num = (v: string) => (v.trim() === "" ? null : Number(v));
    const payload = {
      name: form.name.trim(),
      code: form.code.trim() || slugify(form.name),
      price: Number(form.price),
      billing_period_months: Number(form.billing_period_months),
      grace_period_days: Number(form.grace_period_days),
      // null (not undefined) so CLEARING the description actually sends the
      // key — an undefined is dropped by JSON.stringify and the old text sticks.
      description: form.description.trim() || null,
      max_products: num(form.products),
      max_storage_mb: num(form.storage_mb),
      max_orders_month: num(form.orders_month),
      grace_orders_month: num(form.grace_orders_month),
      retention_months: num(form.retention_months),
      max_branches: num(form.branches),
      max_staff: num(form.staff),
      max_registers: num(form.registers),
      // A plan that does not grant offline selling sends 0, not null: null
      // would mean "this plan has no opinion" and the shop would fall to the
      // platform default, which is also off — but for a different reason, and
      // the admin screen would then be unable to say which.
      max_offline_selling: form.offline_selling ? 1 : 0,
      max_offline_days: num(form.offline_days),
      is_active: form.is_active,
      is_custom: form.is_custom,
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
      message: "Only possible if no business is on it. This can't be undone.",
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
  const ladder = rows.filter((p) => !p.is_custom);
  const custom = rows.filter((p) => p.is_custom);

  const card = (plan: Plan) => (
    <div
      key={plan.id}
      className="flex flex-col rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="font-semibold text-gray-800 dark:text-white/90">{plan.name}</h3>
        <div className="flex shrink-0 gap-1.5">
          {plan.is_custom && <Badge size="sm" color="warning">custom</Badge>}
          <Badge size="sm" color={plan.is_active ? "success" : "light"}>
            {plan.is_active ? "active" : "inactive"}
          </Badge>
        </div>
      </div>
      <p className="mb-1 text-2xl font-bold tabular-nums text-gray-800 dark:text-white/90">
        {money(plan.price)}
        <span className="text-sm font-normal text-gray-400"> / {plan.billing_period_months ?? 1} mo</span>
      </p>
      {plan.description && (
        <p className="mb-3 text-theme-xs text-gray-500 dark:text-gray-400">{plan.description}</p>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        <Badge size="sm" color="light">{plan.grace_period_days ?? 7}d grace</Badge>
        {plan.tenants_count !== undefined && (
          <Badge size="sm" color="light">{plan.tenants_count} businesses</Badge>
        )}
      </div>
      {plan.limits && (
        <dl className="mb-4 space-y-3 border-t border-gray-100 pt-3 text-theme-xs dark:border-gray-800">
          {/* THE THREE QUESTIONS A BUYER ACTUALLY ASKS, FIRST.
              This card used to lead with product ceiling and photo storage —
              two numbers nobody has ever rung up about — while branches,
              staff and tills, which are the first three questions on every
              call, were not on a plan at all. */}
          <div className="grid grid-cols-3 gap-2 text-center">
            {([
              ["Branches", plan.limits.branches],
              ["Staff", plan.limits.staff],
              ["Tills", plan.limits.registers],
            ] as const).map(([label, value]) => (
              <div key={label} className="rounded-lg bg-gray-50 py-2 dark:bg-white/[0.04]">
                <p className="text-base font-semibold tabular-nums text-gray-800 dark:text-white/90">
                  {value ?? plan.defaults?.[label.toLowerCase() === "tills" ? "registers" : label.toLowerCase() === "staff" ? "staff" : "branches"] ?? "—"}
                </p>
                <p className="text-gray-400">{label}</p>
              </div>
            ))}
          </div>

          <div className="space-y-1 text-gray-500 dark:text-gray-400">
            <div className="flex justify-between">
              <dt>Bills a month</dt>
              <dd className="font-medium tabular-nums text-gray-700 dark:text-gray-300">
                {fmtLimit(plan.limits.orders_month)}
                {plan.grace_orders_month ? (
                  <span className="font-normal text-gray-400"> +{plan.grace_orders_month.toLocaleString()} over</span>
                ) : null}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>History online</dt>
              <dd className="font-medium tabular-nums text-gray-700 dark:text-gray-300">{fmtMonths(plan.limits.retention_months)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Selling offline</dt>
              <dd className="font-medium text-gray-700 dark:text-gray-300">
                {(plan.limits.offline_selling ?? 0) > 0
                  ? `Up to ${plan.limits.offline_days ?? 3} day${(plan.limits.offline_days ?? 3) === 1 ? "" : "s"}`
                  : "Not included"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Products</dt>
              <dd className="font-medium tabular-nums text-gray-700 dark:text-gray-300">{fmtLimit(plan.limits.products)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Photo storage</dt>
              <dd className="font-medium tabular-nums text-gray-700 dark:text-gray-300">{fmtStorage(plan.limits.storage_mb)}</dd>
            </div>
          </div>
        </dl>
      )}
      <div className="mt-auto flex gap-3 text-sm">
        <button className={ROW_ACTION} onClick={() => openEdit(plan)}>
          Edit
        </button>
        <button className={ROW_ACTION} onClick={() => toggleActive(plan)}>
          {plan.is_active ? "Deactivate" : "Activate"}
        </button>
        <button className={ROW_ACTION_DANGER} onClick={() => deletePlan(plan)}>
          Delete
        </button>
      </div>
    </div>
  );

  return (
    <>
      <PageMeta title="Plans | True Serve Admin" description="Subscription plans" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Plans</h2>
          <p className="max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            What a business pays, and how much it may have. Modules are decided per business and no plan
            touches them — so the same plan suits a petrol pump and a pharmacy.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => openCreate(true)}>+ Custom plan</Button>
          <Button size="sm" onClick={() => openCreate(false)}>+ New plan</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-56 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
            ))
          : ladder.map(card)}
      </div>

      {custom.length > 0 && (
        <>
          <div className="mb-4 mt-8">
            <h3 className="font-semibold text-gray-800 dark:text-white/90">Custom plans</h3>
            <p className="text-theme-xs text-gray-500 dark:text-gray-400">
              Negotiated with one business. Kept out of the ladder above so the price list stays readable.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{custom.map(card)}</div>
        </>
      )}

      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-lg p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">
          {editing ? `Edit ${editing.name}` : form.is_custom ? "New custom plan" : "New plan"}
        </h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          A plan decides how MUCH a business may have. What it may DO is decided per business, so the same
          plan suits a petrol pump and a pharmacy.
        </p>

        <div className="max-h-[70dvh] space-y-4 overflow-y-auto pr-1">
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
              <Label>Price (Rs)</Label>
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

          {/* ── What the organisation may be ───────────────────────── */}
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="mb-3">
              <p className="text-sm font-medium text-gray-800 dark:text-white/90">Size of the organisation</p>
              <p className="text-theme-xs text-gray-400">
                The first three questions on every sales call. An admin can still raise any of them for one
                business without minting a plan for it.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label>Branches</Label>
                <Input type="number" min="1" value={form.branches} onChange={(e) => set("branches", e.target.value)} placeholder="1" />
              </div>
              <div>
                <Label>Staff logins</Label>
                <Input type="number" min="1" value={form.staff} onChange={(e) => set("staff", e.target.value)} placeholder="5" />
              </div>
              <div>
                <Label>Checkout lanes</Label>
                <Input type="number" min="1" value={form.registers} onChange={(e) => set("registers", e.target.value)} placeholder="2" />
              </div>
            </div>
            {/* THE ONE PLACE "BLANK" DOES NOT MEAN UNLIMITED, said out loud.
                Everywhere else on this form an empty box is no ceiling at
                all; here it is the platform default, because a shop with
                unlimited staff accounts is a shop nobody is counting. */}
            <p className="mt-2 text-theme-xs text-gray-400">
              Blank here is <span className="font-medium">not</span> unlimited — it falls to the platform default
              (1 branch, 5 staff, 2 lanes). The owner's own login is never counted as staff.
            </p>
          </div>

          {/* ── What it may consume ─────────────────────────────────── */}
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="mb-3">
              <p className="text-sm font-medium text-gray-800 dark:text-white/90">Usage included</p>
              <p className="text-theme-xs text-gray-400">
                Blank = unlimited. Bills a month is the meter that matters; products and storage are
                reported, not charged on.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label>Bills a month</Label>
                <Input type="number" min="1" value={form.orders_month} onChange={(e) => set("orders_month", e.target.value)} placeholder="Unlimited" />
                {/* WHY BILLS AND NOT RUPEES. Two shops both turning over
                    Rs 5,000,000 — one writing 1,000 invoices, the other
                    20,000 — cost twenty times apart, and the rupee figure
                    cannot tell them apart. */}
                <p className="mt-1 text-theme-xs text-gray-400">
                  Completed sales. Cancelled ones are not counted — billing a shop for a mis-key is
                  indefensible.
                </p>
              </div>
              <div>
                <Label>Allowed over</Label>
                <Input type="number" min="0" value={form.grace_orders_month} onChange={(e) => set("grace_orders_month", e.target.value)} placeholder="None" />
                <p className="mt-1 text-theme-xs text-gray-400">
                  Room past the included figure before anyone need worry. The till never stops either way —
                  a shop that cannot take money at 4pm on a Saturday is not a billing success.
                </p>
              </div>
              <div>
                <Label>Products</Label>
                <Input type="number" min="1" value={form.products} onChange={(e) => set("products", e.target.value)} placeholder="Unlimited" />
              </div>
              <div>
                <Label>Photo storage (MB)</Label>
                <Input type="number" min="1" value={form.storage_mb} onChange={(e) => set("storage_mb", e.target.value)} placeholder="Unlimited" />
              </div>
            </div>
          </div>

          {/* ── How long, and how far from the server ───────────────── */}
          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="mb-3">
              <p className="text-sm font-medium text-gray-800 dark:text-white/90">History and offline</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label>History online (months)</Label>
                <Input type="number" min="1" value={form.retention_months} onChange={(e) => set("retention_months", e.target.value)} placeholder="Kept for good" />
                {/* MONTHS, so eighteen is sayable. And the sentence that
                    matters most on this whole form: a plan window ARCHIVES,
                    it never deletes. An admin typing 24 here would otherwise
                    reasonably fear they are destroying a shop's records. */}
                <p className="mt-1 text-theme-xs text-gray-400">
                  Older records are <span className="font-medium">archived, never deleted</span>. They drop out of
                  lists and reports, every screen says why, and raising the plan brings them straight back.
                  Stock levels and customer balances are never touched.
                </p>
              </div>
              <div>
                <Label>Days a till may sell offline</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.offline_days}
                  onChange={(e) => set("offline_days", e.target.value)}
                  placeholder="3"
                  disabled={!form.offline_selling}
                />
                <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4"
                    checked={form.offline_selling}
                    onChange={(e) => set("offline_selling", e.target.checked)}
                  />
                  <span>
                    <span className="font-medium">Selling offline is included</span>
                    <span className="block text-theme-xs text-gray-400">
                      The one capability a plan decides. Every trade wants it, so it is a rung on the ladder
                      rather than a module — and an admin can still grant it to one shop on a cheaper plan.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.is_custom} onChange={(e) => set("is_custom", e.target.checked)} />
            <span>
              <span className="font-medium">Custom plan</span>
              <span className="block text-theme-xs text-gray-400">
                Negotiated with one business — listed separately from the standard ladder.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" className="h-4 w-4" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} />
            Active (can be assigned to a business)
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
