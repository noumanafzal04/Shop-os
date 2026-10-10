import type { LimitUsage } from "../auth/types";
import type { Tone } from "./components/face";

/**
 * A SHOP, AT A GLANCE — the four things asked of its page first.
 *
 * A shop's page on the console is everything about it, top to bottom: details,
 * modules, usage, capacity, offline selling, its people, its payments — a
 * little over four screens. The four questions an admin opens it with were
 * scattered down that length: what plan it is on (a row in a card), when it
 * renews (the same card), what it pays (the side column), how big it is (the
 * third card down).
 *
 * This works those four answers out, in words, so the page can say them
 * before anything else. Pure, so the sentences can be tested on the days that
 * break them — the last day, the day after, a shop on no plan at all.
 */
export interface Glance {
  label: string;
  value: string;
  hint: string;
  tone: Tone;
}

interface ShopSeen {
  plan?: { name: string } | null;
  subscription_ends_at?: string | null;
  subscription_state?: "active" | "grace" | "read_only" | string | null;
  grace_ends_at?: string | null;
  limits_usage?: LimitUsage[];
  package?: {
    bill: { plan: { name: string | null; price: number; months: number }; addons: Array<unknown>; total: number };
  } | null;
}

const rupees = (n: number): string => `Rs ${Math.round(n).toLocaleString()}`;
const every = (months: number): string => (months === 1 ? "a month" : `every ${months} months`);
const plural = (n: number, one: string, many: string): string => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const day = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/**
 * Days from today to the day a moment falls on — by the CALENDAR, not by
 * twenty-four hours.
 *
 * A subscription that runs out at six this evening runs out today. Counted in
 * hours and rounded up it was "tomorrow", and one that ran out at nine this
 * morning was already "yesterday" at noon.
 */
export function daysUntil(iso: string, now: Date = new Date()): number {
  const then = new Date(iso);
  const dayOf = (d: Date): number => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());

  return Math.round((dayOf(then) - dayOf(now)) / 86_400_000);
}

export function glanceAt(shop: ShopSeen, now: Date = new Date()): Glance[] {
  const out: Glance[] = [];
  const bill = shop.package?.bill ?? null;

  // ── What plan it is on ──────────────────────────────────────────────
  out.push(
    shop.plan
      ? {
          label: "Plan",
          value: shop.plan.name,
          hint: bill ? `${rupees(bill.plan.price)} ${every(bill.plan.months)}` : "Its price is on the Plans screen",
          tone: "brand",
        }
      : {
          // The state every shop kept from a demo starts in. Said as the
          // thing to DO about it, not as an absence.
          label: "Plan",
          value: "No plan yet",
          hint: "Give it one — nothing is billed until then",
          tone: "amber",
        },
  );

  // ── When it renews ──────────────────────────────────────────────────
  const ends = shop.subscription_ends_at ?? null;
  if (ends === null) {
    out.push({ label: "Renews", value: "—", hint: "No subscription is running", tone: "slate" });
  } else if (shop.subscription_state === "read_only") {
    out.push({ label: "Ran out", value: day(ends), hint: "Past its grace — the shop can read and cannot change anything", tone: "red" });
  } else if (shop.subscription_state === "grace") {
    out.push({
      label: "Ran out",
      value: day(ends),
      hint: shop.grace_ends_at ? `In grace — read-only from ${day(shop.grace_ends_at)}` : "In grace — still working, and due",
      tone: "amber",
    });
  } else {
    const left = daysUntil(ends, now);
    out.push({
      label: "Renews",
      value: day(ends),
      hint: left <= 0 ? "Today" : left === 1 ? "Tomorrow" : `In ${left.toLocaleString()} days`,
      // A week is when somebody should be rung.
      tone: left <= 7 ? "amber" : "green",
    });
  }

  // ── What it pays ────────────────────────────────────────────────────
  if (bill) {
    out.push({
      label: "Pays",
      value: rupees(bill.total),
      hint: `${every(bill.plan.months)} · ${bill.addons.length === 0 ? "no add-ons" : plural(bill.addons.length, "add-on", "add-ons")}`,
      tone: "slate",
    });
  }

  // ── How big it is ───────────────────────────────────────────────────
  const used = (key: string): number | null => shop.limits_usage?.find((row) => row.key === key)?.used ?? null;
  const branches = used("branches");
  if (branches !== null) {
    const staff = used("staff");
    const lanes = used("registers");
    out.push({
      label: "Size",
      value: plural(branches, "branch", "branches"),
      hint: [
        staff === null ? null : plural(staff, "member of staff", "staff"),
        lanes === null ? null : plural(lanes, "checkout lane", "checkout lanes"),
      ].filter(Boolean).join(" · ") || "As its plan allows",
      tone: "sky",
    });
  }

  return out;
}
