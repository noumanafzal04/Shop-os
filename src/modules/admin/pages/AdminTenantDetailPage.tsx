import { useState } from "react";
import { Link, useParams } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import { ModulePicker } from "../components/ModulePicker";
import { DemoBanner } from "../components/DemoBanner";
import Label from "../../../components/form/Label";
import Input from "../../../components/form/input/InputField";
import Select from "../../../components/form/Select";
import { Modal, ModalForm } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { failed } from "../../../common/api/failed";
import { useToast } from "../../../components/ui/toast";
import { useConfirm } from "../../../components/ui/confirm";
import { ApiError } from "../../../common/types/api";
import { useAdminCities, useAdminTenant, useEndGrant, useEntitlements, useExtendLimits, useGrantCapacity, useModuleCatalog, useModulePrices, usePayments, usePlans, usePlanChangePreview, useResetOwnerPassword, useTenantMutations, useUpdateModules } from "../hooks/useAdmin";
import type { Entitlement, Plan, PlanChangePreview, TenantPackage } from "../services/adminService";
import { useBusinessTypes } from "../../shop/hooks/useShop";
import { useEffect } from "react";
import type { LimitUsage, Tenant } from "../../auth/types";
import { toIsoDate } from "../../../components/ui/filters";

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

  /**
   * HOW LONG BLIND IS TOO LONG — the second decision, which no screen could
   * reach either.
   *
   * `offline_days` has been in PlanLimits as long as `offline_selling` has,
   * and the limits modal beside this card lists only COUNTABLE ceilings —
   * products, storage, branches, staff, lanes. A policy measured in days is
   * not one of those, so it fell through the same crack its neighbour did.
   * The only way to give a shop a seven-day or a thirty-day window was to
   * hand-write an HTTP request. That is the eighth time this console has had
   * a setting the server obeys and nobody can press.
   *
   * WHAT IT DOES, precisely, because the name invites the wrong guess:
   *
   *   it does NOT expire the cached catalogue — that never expires
   *   it does NOT stop the till selling
   *   it does NOT stop anything syncing — a sale rung forty days ago still
   *     lands, and the queue has no expiry at all
   *
   * It MARKS. Past this many days since the till went dark, a sale arrives
   * flagged, and Reports → Offline can show the owner which sales were rung
   * on a catalogue nobody had updated. Three is a starting point, not a
   * ceiling: a shop that loses its line for a week should raise it, or every
   * sale after Wednesday is flagged and the report stops being read.
   */
  const windowDays = tenant.limits?.offline_days ?? 3;
  const [days, setDays] = useState(String(windowDays));

  const saveWindow = () => {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1) {
      toast.error("The window is a whole number of days, at least one.");

      return;
    }
    extend.mutate(
      { id: tenant.id, limits: { offline_days: n }, mode: "set" },
      {
        onSuccess: () => toast.success(`Sales are flagged after ${n} day${n === 1 ? "" : "s"} offline.`),
        onError: (e) => toast.error(e instanceof Error ? e.message : "That could not be changed."),
      },
    );
  };

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

      {granted && (
        <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
          <Label>Flag sales after</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              min="1"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="max-w-[7rem]"
            />
            <span className="text-theme-sm text-gray-500 dark:text-gray-400">days offline</span>
            <Button size="sm" variant="outline" disabled={extend.isPending} onClick={saveWindow}>
              Save
            </Button>
          </div>
          <p className="mt-2 max-w-xl text-theme-xs text-gray-500 dark:text-gray-400">
            This only MARKS. It does not stop the till selling, it does not expire
            the cached catalogue, and it never stops a sale syncing — a sale rung
            forty days ago still lands. Past this many days since the line
            dropped, a sale arrives flagged so Reports → Offline can show which
            ones were rung on a catalogue nobody had updated.
          </p>
          <p className="mt-1 text-theme-xs text-gray-400">
            Raise it for a shop whose line goes for a week: if everything is
            flagged, nothing is.
          </p>
        </div>
      )}

      <p className="mt-3 text-theme-xs text-gray-400">
        Everything else about offline needs no setup: a till registers itself,
        caches the catalog and runs the pricing comparison the first time the
        shop opens the POS.
      </p>
    </div>
  );
}

/**
 * WHAT THIS PLAN CHANGE WOULD DO, BEFORE IT DOES IT.
 *
 * Two facts, and they are not equally important.
 *
 * The price difference an admin can work out for themselves — it is two
 * numbers on the same dropdown. What they cannot work out is that THIS
 * shop has six staff accounts and the plan they are hovering over includes
 * three. That is what the warning is for, and it is why this block renders
 * before the Assign button rather than as a toast afterwards.
 *
 * It refuses nothing. A downgrade that leaves a shop over its new ceiling
 * is an ordinary commercial situation — a chain closing a branch next
 * month, a team shrinking after Eid — and three answers follow from being
 * told: remove the excess, sell them an add-on, or leave it. All three are
 * the admin's to pick, and none of them is this screen's.
 *
 * What must never happen is the fourth: the plan changes, seven staff
 * accounts stop working on Monday, and nobody was warned.
 */
function PlanChangePreviewBlock({ preview }: {
  preview: { data?: PlanChangePreview; isLoading: boolean; isError: boolean };
}) {
  if (preview.isLoading) {
    return <div className="h-20 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />;
  }
  // Silent on error and when idle. A broken preview must not stop an admin
  // doing the thing they came to do; it just stops helping.
  if (preview.isError || !preview.data) return null;

  const p = preview.data;
  const diff = p.price_difference;
  const per = p.billing_period_months > 1 ? `every ${p.billing_period_months} months` : "a month";

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
      <div className="flex flex-wrap items-baseline gap-2 text-theme-sm">
        <span className="text-gray-500 dark:text-gray-400">{p.from.name ?? "No plan"}</span>
        <span className="text-gray-400">→</span>
        <span className="font-medium text-gray-800 dark:text-white/90">{p.to.name}</span>
        {diff !== 0 && (
          <span className={`ml-auto tabular-nums ${diff > 0 ? "text-success-600 dark:text-success-500" : "text-warning-600 dark:text-warning-400"}`}>
            {diff > 0 ? "+" : "−"}Rs {Math.abs(diff).toLocaleString()} {per}
          </span>
        )}
      </div>

      {/* Only the rows that actually move. A table of eleven, nine of them
          unchanged, is a table nobody reads to the bottom. */}
      {p.rows.filter((r) => r.from !== r.to).length > 0 && (
        <table className="w-full text-left text-theme-xs">
          <tbody>
            {p.rows.filter((r) => r.from !== r.to).map((r) => (
              <tr key={r.key} className="text-gray-500 dark:text-gray-400">
                <td className="py-0.5">{r.label}</td>
                <td className="py-0.5 text-right tabular-nums">{r.from === null ? "∞" : r.from.toLocaleString()}</td>
                <td className="w-5 py-0.5 text-center text-gray-400">→</td>
                <td className="py-0.5 text-right font-medium tabular-nums text-gray-700 dark:text-gray-300">
                  {r.to === null ? "∞" : r.to.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {p.excess.length > 0 && (
        <div className="rounded-lg bg-warning-50 p-3 text-theme-xs dark:bg-warning-500/10">
          <p className="font-medium text-warning-700 dark:text-warning-400">
            This shop would be over {p.excess.length === 1 ? "one ceiling" : `${p.excess.length} ceilings`}.
          </p>
          <ul className="mt-1 space-y-0.5 text-warning-700/90 dark:text-warning-400/90">
            {p.excess.map((r) => (
              <li key={r.key}>
                {r.label}: {r.used.toLocaleString()} in use, {r.to?.toLocaleString()} allowed
                {" — "}
                {r.blocks
                  ? "no more can be added until it is raised"
                  : "nothing is blocked; the plan stops covering it"}
              </li>
            ))}
          </ul>
          {/* The three ways out, named. Nothing here is deleted and nothing
              is refused — but an admin who presses on should have chosen to. */}
          <p className="mt-2 text-warning-700/80 dark:text-warning-400/80">
            Nothing is deleted. Remove the excess, grant the extra capacity below, or go ahead and leave it over.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * THREE QUESTIONS, NOT ONE LIST.
 *
 * Every limit used to render as a progress bar, which produced rows an admin
 * could only read as a bug:
 *
 *     offline selling (0 = off, 1 = on)      0 / 0
 *     hard stop after N days offline          0 / 0
 *
 * That is a SWITCH drawn as a quota, and a quota of zero at that. The labels
 * had to carry their own instructions because the control underneath them was
 * the wrong shape.
 *
 * The three sections are three different conversations:
 *
 *   CAPACITY   how big is this organisation. A number sold on the plan,
 *              raiseable for one shop, and the thing a downgrade collides
 *              with.
 *   USAGE      what did they consume this period. A meter that resets.
 *   POLICIES   what are they allowed to do. Not a quantity at all.
 */
const SECTIONS: Array<{ title: string; note: string; keys: string[]; policy?: boolean }> = [
  {
    title: "Capacity",
    note: "in use / allowed",
    keys: ["branches", "staff", "registers"],
  },
  {
    title: "Usage this period",
    // Named, because "this month" is wrong for a shop billed quarterly and
    // for one whose month starts on the 12th.
    note: "resets each billing period",
    keys: ["orders_month", "products", "storage_mb"],
  },
  {
    title: "Policies",
    note: "what this shop is allowed to do",
    keys: ["offline_selling", "offline_days", "offline_hard_stop_days"],
    policy: true,
  },
];

/** One line of the picture. How it draws depends on what kind of thing it is. */
function UsageRow({ row: u, assigned, onReset }: {
  row: LimitUsage;
  assigned: boolean;
  onReset: () => void;
}) {
  const fmt = (n: number | null | undefined) => (n == null ? "Unlimited" : n.toLocaleString());

  /**
   * A YES/NO IS A YES/NO.
   *
   * Drawn as a state, not as "0 / 1". The provenance line still says where
   * the answer came from, because "off" means something different when the
   * plan withholds it and when an admin turned it off for this shop.
   */
  if (u.switch) {
    const on = u.limit !== null && u.limit > 0;

    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-gray-700 dark:text-gray-300">{u.label}</span>
        <span className="flex items-center gap-2">
          {assigned && <Badge size="sm" color="light">set here</Badge>}
          <Badge size="sm" color={on ? "success" : "light"}>{on ? "Allowed" : "Not allowed"}</Badge>
        </span>
      </div>
    );
  }

  /**
   * A POLICY NUMBER IS A SETTING, NOT A QUOTA.
   *
   * `offline_days` reports the worst device currently out of contact. Three
   * days out against a three-day window is a tablet that is LATE — calling
   * it "100% used" puts a billing word on an operational fact, which is why
   * the server returns no band for these at all.
   */
  if (u.band === null && !u.unlimited) {
    const zeroMeans = u.zero_means;
    const value = u.limit === 0 && zeroMeans ? zeroMeans : `${u.limit?.toLocaleString()} days`;

    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-gray-700 dark:text-gray-300">{u.label}</span>
        <span className="flex items-center gap-2 text-sm">
          {u.used > 0 && (
            <span className="text-theme-xs text-gray-400">worst device {u.used}d out</span>
          )}
          {assigned && <Badge size="sm" color="light">set here</Badge>}
          <span className="font-medium text-gray-700 dark:text-gray-300">{value}</span>
        </span>
      </div>
    );
  }

  const pct = u.percent ?? 0;
  const band = u.band;
  const bar =
    band === "over" ? "bg-error-500"
    : band === "grace" ? "bg-warning-500"
    : band === "reached" ? "bg-error-400"
    : band === "critical" ? "bg-warning-500"
    : band === "nearing" ? "bg-warning-400"
    : "bg-brand-500";
  const extra = u.extra ?? 0;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
          {u.label}
          {/* Say what was granted, not just that something was. An admin
              about to change a ceiling needs to know whether 1,100 is the
              plan or 1,000 plus 100 they gave in March. */}
          {assigned && (
            <Badge size="sm" color={extra > 0 ? "info" : extra < 0 ? "warning" : "light"}>
              {extra > 0 ? `+${extra.toLocaleString()}` : extra < 0 ? extra.toLocaleString() : "set here"}
            </Badge>
          )}
          {(u.granted ?? 0) > 0 && (
            <Badge size="sm" color="success">+{(u.granted ?? 0).toLocaleString()} bought</Badge>
          )}
        </span>
        <span className="tabular-nums text-gray-500 dark:text-gray-400">
          {u.used.toLocaleString()}{" / "}
          <span className="font-medium text-gray-700 dark:text-gray-300">
            {u.unlimited ? "∞" : u.limit?.toLocaleString()}
          </span>
        </span>
      </div>
      {!u.unlimited && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
          {/* Clamped at 100 because a bar cannot be 110% long. The WORD
              below says 110, which is the number that matters. */}
          <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      )}
      {/* A COLOUR IS NOT A SENTENCE. Most of these are reported and
          deliberately not enforced — a hard stop in the middle of a queue is
          the failure the offline module exists to avoid — and a bar going
          red says nothing an admin can act on. */}
      {band !== null && band !== "ok" && (
        <p
          className={`mt-1 text-theme-xs ${
            band === "over"
              ? "text-error-600 dark:text-error-400"
              : "text-warning-600 dark:text-warning-400"
          }`}
        >
          {band === "over"
            ? u.blocks
              ? `Over the ceiling (${pct}%) — nothing more can be added until it is raised.`
              : `Over the plan (${pct}%). Still selling — nothing is blocked — but this is an account to ring.`
            : band === "grace"
              ? `Past the included ${u.limit?.toLocaleString()}, inside the ${u.grace?.toLocaleString()} allowed over. Room until ${u.grace_until?.toLocaleString()}.`
              : band === "reached"
                ? `All ${u.limit?.toLocaleString()} used — exactly what the plan includes.${u.grace ? ` ${u.grace.toLocaleString()} more allowed before anyone need worry.` : ""}`
                : band === "critical"
                  ? `${pct}% used — worth a call before the period ends.`
                  : `${pct}% used.`}
        </p>
      )}
      {assigned ? (
        <div className="mt-1 flex items-center gap-2 text-theme-xs text-gray-400">
          <span>Set for this shop. Plan includes {fmt(u.baseline)}</span>
          <button type="button" onClick={onReset} className="text-brand-500 hover:text-brand-600">
            Back to the plan
          </button>
        </div>
      ) : (
        <p className="mt-1 text-theme-xs text-gray-400">
          {u.owner === "plan" ? "From the plan" : "Included in the plan"}: {fmt(u.baseline)}
        </p>
      )}
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
        <div className="space-y-6">
          {SECTIONS.map((section) => {
            const rows = section.keys
              .map((k) => usage.find((u) => u.key === k))
              .filter((u): u is LimitUsage => u !== undefined);
            if (rows.length === 0) return null;

            return (
              <section key={section.title}>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h4 className="text-theme-xs font-medium uppercase tracking-wide text-gray-400">
                    {section.title}
                  </h4>
                  <span className="text-theme-xs text-gray-400">{section.note}</span>
                </div>
                <div className={section.policy ? "space-y-2" : "space-y-4"}>
                  {rows.map((u) => (
                    <UsageRow
                      key={u.key}
                      row={u}
                      assigned={assigned[u.key] != null}
                      onReset={() => clearOverride(u.key)}
                    />
                  ))}
                </div>
              </section>
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

/**
 * THE ADD-ONS THAT ARE ACTUALLY SOLD.
 *
 * A shop on Basic that needs five staff should not be pushed onto Standard
 * to get two of them. That is the entire argument for add-ons — and it only
 * works if the price of an extra staff account is the SAME price next week
 * and for the shop next door.
 *
 * Granting capacity was three free-text boxes, so it was not. The list below
 * is what the sales conversation actually offers; the boxes underneath still
 * take anything, because the reason a per-tenant grant exists at all is the
 * deal that is not on a list.
 *
 * Priced per billing period, like the plan they sit on top of — a monthly
 * shop pays this monthly, an annual one annually, and nobody has to divide.
 */
const ADD_ONS: ReadonlyArray<{ key: string; label: string; quantity: number; price: number }> = [
  { key: "staff", label: "+1 staff login", quantity: 1, price: 400 },
  { key: "registers", label: "+1 checkout lane", quantity: 1, price: 600 },
  { key: "branches", label: "+1 branch", quantity: 1, price: 1500 },
  // Sold as a pack rather than per bill: nobody buys 1 transaction, and a
  // per-unit price on a meter this large reads as a threat.
  { key: "orders_month", label: "+5,000 bills a month", quantity: 5000, price: 750 },
];

/** Admin-only editor for a tenant's business type + category (owners can't). */
/**
 * CAPACITY SOLD OR GIVEN — the add-on, the temporary grant, the concession.
 *
 * Its own card beside Usage & limits, because the two answer different
 * questions and conflating them is how the information was lost in the first
 * place. "Extend limits" ASSIGNS the size of the organisation: this shop is a
 * three-branch business. These rows say what was bought on top of it, at what
 * price, and until when.
 *
 * Writing 13 into the staff limit gives a shop thirteen and loses everything
 * else: why, who is paying for the three, and when it ends. Three extra users
 * at Rs 400 is Rs 1,200 a month that nobody can bill, because there was no
 * line to bill.
 */
function CapacityCard({ tenant }: { tenant: Tenant }) {
  const toast = useToast();
  const confirm = useConfirm();
  const modal = useModal();
  const rows = useEntitlements(tenant.id);
  const grant = useGrantCapacity();
  const end = useEndGrant();

  const meters = (tenant.limits_usage ?? []).filter((u) => u.key !== "offline_selling" && u.key !== "offline_days");

  const [form, setForm] = useState({
    limit_key: "staff",
    quantity: "",
    unit_price: "",
    ends_on: "",
    note: "",
  });

  const open = () => {
    setForm({ limit_key: meters[0]?.key ?? "staff", quantity: "", unit_price: "", ends_on: "", note: "" });
    grant.reset();
    modal.openModal();
  };

  const save = async () => {
    const qty = Number(form.quantity);
    if (!Number.isFinite(qty) || qty < 1) {
      toast.error("How much extra capacity? Enter a whole number.");
      return;
    }

    try {
      const res = await grant.mutateAsync({
        id: tenant.id,
        body: {
          limit_key: form.limit_key,
          quantity: qty,
          // EMPTY IS NOT ZERO. A blank price means nobody set one; a typed 0
          // means it was agreed free, and an invoice run has to tell them
          // apart. Sending 0 for a blank box would silently decide.
          unit_price: form.unit_price.trim() === "" ? null : Number(form.unit_price),
          ends_on: form.ends_on || null,
          note: form.note.trim() || null,
        },
      });
      toast.success(res.message ?? "Capacity granted.");
      modal.closeModal();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not grant that.");
    }
  };

  const money = (v: number | null) =>
    v === null ? "—" : `Rs ${v.toLocaleString(undefined, { minimumFractionDigits: 0 })}`;

  const list = rows.data ?? [];
  const billable = list
    .filter((r: Entitlement) => r.state === "live" && r.period_value !== null)
    .reduce((sum: number, r: Entitlement) => sum + (r.period_value ?? 0), 0);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-800 dark:text-white/90">Bought &amp; granted</h3>
          <p className="text-theme-xs text-gray-500 dark:text-gray-400">
            Capacity on top of the plan — what it costs, and when it ends.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={open}>Grant capacity</Button>
      </div>

      {rows.isPending ? (
        <div className="h-20 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
      ) : list.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
          Nothing bought or granted. The shop has exactly what its plan and its assigned limits give it.
        </p>
      ) : (
        <ul className="space-y-3">
          {list.map((r: Entitlement) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-3 last:border-0 last:pb-0 dark:border-gray-800">
              <div>
                <p className="text-sm text-gray-800 dark:text-white/90">
                  +{r.quantity.toLocaleString()} {r.label}
                  {/* A lapsed grant is kept and SAID to be lapsed. It is the
                      answer to why the shop had thirteen staff in November. */}
                  <span className="ml-2 inline-flex align-middle">
                    <Badge size="sm" color={r.state === "live" ? "success" : r.state === "pending" ? "info" : "light"}>
                      {r.state === "live" ? "in force" : r.state === "pending" ? "from " + r.starts_on : "ended " + r.ends_on}
                    </Badge>
                  </span>
                </p>
                <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
                  {money(r.period_value)} per period
                  {r.unit_price === null && " · no price set"}
                  {r.ends_on && r.state !== "expired" && ` · until ${r.ends_on}`}
                  {r.note && ` · ${r.note}`}
                </p>
              </div>
              {r.state !== "expired" && (
                <button
                  type="button"
                  className="text-theme-xs text-error-600 hover:underline dark:text-error-400"
                  disabled={end.isPending}
                  onClick={async () => {
                    const yes = await confirm({
                      title: `End +${r.quantity} ${r.label}?`,
                      message:
                        "It ends TODAY and the shop keeps the capacity for the rest of the day. The row stays — "
                        + "a grant that has already been billed cannot be made never to have existed.",
                      confirmLabel: "End it today",
                      tone: "danger",
                    });
                    if (!yes) return;

                    try {
                      await end.mutateAsync({ id: tenant.id, entitlementId: r.id });
                      toast.success("Grant ends today.");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Could not end it.");
                    }
                  }}
                >
                  End
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {billable > 0 && (
        <p className="mt-4 border-t border-gray-100 pt-3 text-theme-sm text-gray-700 dark:border-gray-800 dark:text-gray-300">
          <span className="text-gray-500 dark:text-gray-400">Billable per period:</span>{" "}
          <span className="font-medium tabular-nums">{money(billable)}</span>
        </p>
      )}

      <Modal isOpen={modal.isOpen} onClose={modal.closeModal} className="max-w-lg p-6">
        <h4 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Grant capacity</h4>
        <p className="mb-5 text-theme-sm text-gray-500 dark:text-gray-400">
          Added on top of what this shop already has — the assigned limit stays readable underneath.
        </p>

        <div className="space-y-4">
          {/* THE USUAL ONES, PRICED.
              Granting capacity was three free-text boxes, which meant the
              price of an extra staff account was whatever the admin on duty
              remembered — and the shop next door was quoted something else.
              These are the list; the boxes underneath still take anything,
              because the whole reason the override exists is the deal that
              is not on the list. */}
          <div>
            <Label>Usual add-ons</Label>
            <div className="grid grid-cols-2 gap-2">
              {ADD_ONS.map((pack) => {
                const picked =
                  form.limit_key === pack.key
                  && form.quantity === String(pack.quantity)
                  && form.unit_price === String(pack.price);

                return (
                  <button
                    key={pack.label}
                    type="button"
                    onClick={() => setForm((f) => ({
                      ...f,
                      limit_key: pack.key,
                      quantity: String(pack.quantity),
                      unit_price: String(pack.price),
                    }))}
                    className={`rounded-xl border p-3 text-left transition ${
                      picked
                        ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                        : "border-gray-200 hover:border-gray-300 dark:border-gray-700"
                    }`}
                  >
                    <div className="text-sm font-medium text-gray-800 dark:text-white/90">{pack.label}</div>
                    <div className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
                      Rs {pack.price.toLocaleString()} each, per billing period
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label htmlFor="grant-key">What</Label>
            <Select
              value={form.limit_key}
              onChange={(v) => setForm((f) => ({ ...f, limit_key: v }))}
              options={meters.map((m) => ({ value: m.key, label: m.label }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="grant-qty">How many more</Label>
              <Input
                id="grant-qty"
                type="number"
                min="1"
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                placeholder="3"
              />
            </div>
            <div>
              <Label htmlFor="grant-price">Price each, per period</Label>
              <Input
                id="grant-price"
                type="number"
                min="0"
                value={form.unit_price}
                onChange={(e) => setForm((f) => ({ ...f, unit_price: e.target.value }))}
                placeholder="Leave blank if free"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="grant-ends">Until (optional)</Label>
            <Input
              id="grant-ends"
              type="date"
              value={form.ends_on}
              onChange={(e) => setForm((f) => ({ ...f, ends_on: e.target.value }))}
            />
            <p className="mt-1 text-theme-xs text-gray-400">
              Blank means for ever, which is what an ordinary paid add-on is. A date here is in force
              through that day.
            </p>
          </div>

          <div>
            <Label htmlFor="grant-note">Why</Label>
            <Input
              id="grant-note"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="Sold with the Gulberg branch"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={modal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={grant.isPending}>
            {grant.isPending ? "Granting…" : "Grant"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

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
function ModulesCard({ tenantId, features, pkg, planName, tradeLabel }: {
  tenantId: string;
  features: Record<string, boolean>;
  pkg?: TenantPackage;
  planName?: string | null;
  tradeLabel?: string | null;
}) {
  const toast = useToast();
  const catalog = useModuleCatalog();
  const prices = useModulePrices();
  const save = useUpdateModules();
  const [state, setState] = useState<Record<string, boolean>>(features);
  // This shop's own prices, as typed. A blank box is the platform's price.
  const asTyped = (own: Record<string, number> | undefined) =>
    Object.fromEntries(Object.entries(own ?? {}).map(([k, v]) => [k, String(v)]));
  const [own, setOwn] = useState<Record<string, string>>(asTyped(pkg?.own_prices));

  useEffect(() => { setState(features); }, [features]);
  useEffect(() => { setOwn(asTyped(pkg?.own_prices)); }, [pkg?.own_prices]);

  const list = catalog.data ?? [];
  const numbers = (typed: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(typed)
        .filter(([k, v]) => v.trim() !== "" && !Number.isNaN(Number(v)) && (state[k] ?? false))
        .map(([k, v]) => [k, Math.max(0, Number(v))]),
    );
  const sameMap = (a: Record<string, number>, b: Record<string, number>) =>
    Object.keys({ ...a, ...b }).every((k) => a[k] === b[k]);
  const pricesChanged = !sameMap(numbers(own), numbers(asTyped(pkg?.own_prices)));
  const dirty = pricesChanged || list.some((m) => (state[m.key] ?? false) !== (features[m.key] ?? false));

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-semibold text-gray-800 dark:text-white/90">Modules</h3>
        {save.isSuccess && !dirty && <span className="text-theme-xs text-success-600">Saved ✓</span>}
      </div>
      <p className="mb-4 text-theme-xs text-gray-400">
        What this business can do. Its plan says what it starts with; anything switched on past the plan is an
        add-on for this shop and is added to its bill. Changing the plan never switches a module off.
      </p>

      <ModulePicker
        catalog={list}
        value={state}
        onChange={setState}
        offer={pkg?.offer}
        prices={prices.data}
        ownPrices={own}
        onOwnPrices={setOwn}
        planName={planName}
        tradeLabel={tradeLabel}
        emptyHint="Modules are still loading."
      />

      <Button size="sm" className="mt-5" disabled={!dirty || save.isPending} onClick={() => save.mutate(
        { id: tenantId, modules: state, addonPrices: numbers(own) },
        // Modules decide which screens a whole shop can open. A save that did
        // not land leaves the toggles showing what was asked for rather than
        // what is true.
        failed(toast, "Those modules did not save — the shop still has the old set."),
      )}>
        {save.isPending ? "Saving…" : "Save modules"}
      </Button>
    </div>
  );
}

/**
 * What this shop owes for one period — its plan, and its add-ons.
 *
 * "If a shop on Basic takes an add-on, how will anybody know next time to
 * charge for it?" This card is the answer: an add-on is any module the shop
 * has past its plan, read off the shop as it stands, so it is on the bill the
 * moment it is switched on and nobody has to remember it.
 */
function BillCard({ pkg }: { pkg: TenantPackage }) {
  const bill = pkg.bill;
  const every = bill.plan.months === 1 ? "a month" : `every ${bill.plan.months} months`;

  return (
    <div data-testid="shop-bill" className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <h3 className="font-semibold text-gray-800 dark:text-white/90">What it pays</h3>
      <p className="mb-4 text-theme-xs text-gray-400">Its plan, and what was added for this shop. Worked out from the shop as it is now.</p>

      <dl className="space-y-2 text-theme-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-gray-700 dark:text-gray-300">{bill.plan.name ?? "No plan"}</dt>
          <dd className="tabular-nums text-gray-800 dark:text-white/90">Rs {Math.round(bill.plan.price).toLocaleString()}</dd>
        </div>
        {bill.addons.map((a) => (
          <div key={a.key} className="flex items-baseline justify-between gap-3">
            <dt className="min-w-0 text-gray-700 dark:text-gray-300">
              <span className="mr-1.5 rounded-full bg-brand-50 px-1.5 py-px text-[11px] font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">Add-on</span>
              {a.label}
              {a.own_price && a.listed !== null && a.listed !== a.monthly && (
                <span className="ml-1.5 text-theme-xs text-gray-400">usually Rs {Math.round(a.listed).toLocaleString()}</span>
              )}
            </dt>
            <dd className="whitespace-nowrap tabular-nums text-gray-800 dark:text-white/90">
              {a.monthly > 0 ? `Rs ${Math.round(a.monthly * bill.plan.months).toLocaleString()}` : <span className="text-gray-400">Free</span>}
            </dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 border-t border-gray-200 pt-2 dark:border-gray-800">
          <dt className="font-medium text-gray-800 dark:text-white/90">Due {every}</dt>
          <dd className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">Rs {Math.round(bill.total).toLocaleString()}</dd>
        </div>
      </dl>
      {bill.addons.length === 0 && (
        <p className="mt-3 text-theme-xs text-gray-400">No add-ons: this shop has exactly what its plan includes, or less.</p>
      )}
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
  // What picking this plan would do to this shop — asked while the admin is
  // still deciding, and never fetched for the plan they are already on.
  const planPreview = usePlanChangePreview(id, planId, t?.plan?.id ?? null);
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
      <PageMeta title={`${t.business_name}`} area="Admin" description="Tenant detail" />

      <div className="mb-6">
        <Link to="/admin/tenants" className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">← Back to tenants</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">{t.business_name}</h2>
          {t.deleted_at ? <Badge color="light">deleted</Badge>
            : t.status === "suspended" ? <Badge color="error">suspended</Badge>
            : <Badge color="success">active</Badge>}
          {t.online_shop_enabled && <Badge color="info">online shop</Badge>}
          {t.is_demo && <Badge color="light">demo</Badge>}
        </div>
      </div>

      {/* A demo says it is one, above everything else, with the one decision
          there is to make about it. */}
      {t.is_demo && !t.deleted_at && <DemoBanner tenant={t} />}

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
          <ModulesCard
            tenantId={t.id}
            features={t.features ?? {}}
            pkg={t.package}
            planName={t.plan?.name ?? null}
            tradeLabel={(businessTypes.data ?? []).find((b) => b.code === (t.business_type_primary ?? t.business_type))?.label.toLowerCase() ?? null}
          />

          {/* Plan usage & per-tenant limit extension */}
          <UsageLimitsCard tenant={t} plan={currentPlan} />
          <CapacityCard tenant={t} />

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

        {/* The side column: what can be done, and — beside it, in sight without
            scrolling — what the shop pays. The bill was half-way down a page
            four screens long. */}
        <div className="h-fit space-y-6">
        {t.package && <BillCard pkg={t.package} />}
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

            <PlanChangePreviewBlock preview={planPreview} />
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
                    max={toIsoDate(new Date())}
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
