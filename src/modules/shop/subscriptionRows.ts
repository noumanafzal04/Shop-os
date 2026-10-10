import type { KindOfBusiness } from "../../common/tenant/kindOfBusiness";

/** The part of a usage row this file reads. The server sends a good deal more. */
export interface LimitRow {
  key: string;
  label: string;
  limit: number | null;
  used: number;
  unlimited: boolean;
  enforced: boolean;
  /** `count` = things owned; `policy` = a rule about behaviour. Absent on an older server. */
  kind?: "count" | "policy";
  /** Whether this business has the module the row is about. Absent on an older server. */
  applies?: boolean;
  /** A yes/no rule: 1 is on, 0 is off. */
  switch?: boolean;
  /** What a zero stands for, when it is not "none". */
  zero_means?: string | null;
}

/**
 * WHAT A BUSINESS IS COUNTED AGAINST — and only that.
 *
 * The Usage card drew every row the server sent as a bar. Two kinds of row
 * should never have been one:
 *
 *   A row about something the business cannot have. An office that bought
 *   only the books read "Products 0 / 1,000", "Orders this month 0 / 5,000"
 *   and "Registers 0 / 1" on the page that says what it pays for. The server
 *   now says whether a row `applies`.
 *
 *   A RULE, drawn as a quantity. "Offline selling 0 / 0" and "Hard stop after
 *   N days offline 0 / 0" are not amounts used out of amounts allowed — the
 *   first is a switch that is off and the second is a ceiling nobody set. As
 *   bars they said nothing true in any reading, to every shop on the
 *   platform. They are sentences now: see `offlineRules`.
 */
export function usageRows<T extends LimitRow>(rows: readonly T[]): T[] {
  return rows.filter(
    (u) => (u.kind ?? "count") === "count" && u.applies !== false && (u.enforced || !u.unlimited),
  );
}

const days = (n: number) => `${n.toLocaleString()} day${n === 1 ? "" : "s"}`;

/**
 * The rules about working with no internet, in words.
 *
 * Nothing at all for a business the rules cannot apply to. And when selling
 * offline is switched off, only that is said: how long a till may stay out of
 * contact is not a fact about a till that may not sell out of contact at all.
 */
export function offlineRules(rows: readonly LimitRow[]): Array<{ key: string; label: string; value: string }> {
  const rule = (key: string) => rows.find((u) => u.key === key && u.kind === "policy" && u.applies !== false);

  const selling = rule("offline_selling");
  if (!selling) return [];

  const on = (selling.limit ?? 0) >= 1;
  const out = [{ key: selling.key, label: "Selling with no internet", value: on ? "On" : "Off — ask support to turn it on" }];
  if (!on) return out;

  const window = rule("offline_days");
  if (window && window.limit !== null) {
    out.push({ key: window.key, label: "A till may stay out of contact for", value: days(window.limit) });
  }

  const stop = rule("offline_hard_stop_days");
  if (stop && stop.limit !== null) {
    out.push({
      key: stop.key,
      label: "A till stops selling after",
      value: stop.limit === 0 ? "Never — it keeps selling and marks the sales" : `${days(stop.limit)} offline`,
    });
  }

  return out;
}

/**
 * What the subscription page says that depends on who it is talking to.
 *
 * "A read-only shop cannot ring a sale" is the most consequential sentence
 * this app says to an owner. Said to a business with no till it is a sentence
 * about somebody else — and the thing that IS paused for it, recording its
 * income and expenses, went unsaid.
 */
export function subscriptionWords(kind: Pick<KindOfBusiness, "sells" | "noun">) {
  const it = kind.noun;

  return {
    lede: `Where your ${it} stands, what it can use, and what has been paid.`,
    noPlan: `No plan on your ${it} yet — no ceiling and no billing period. Nothing is limited in the meantime; the platform team will set one up.`,
    runs: `What your ${it} runs`,
    active: `Your ${it} is active`,
    grace: `Your ${it} is working normally through its grace period.`,
    graceLoses: kind.sells
      ? "it becomes read-only — you would still see everything, but not be able to ring a sale."
      : "it becomes read-only — you would still see everything, but not be able to record anything new.",
    readOnly: kind.sells
      ? `The ${it} is read-only: everything you have is here and nothing has been deleted, but new sales, stock changes and expenses are paused until it is renewed.`
      : `The ${it} is read-only: everything you have is here and nothing has been deleted, but new income and expense entries are paused until it is renewed.`,
    // Only a business with a shelf or a khata has either to be reassured about.
    archivedReassurance: kind.sells ? " Your stock levels and customer balances are never affected." : "",
    extended: `Extended for your ${it} beyond the plan's`,
  };
}
