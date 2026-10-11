/**
 * WHAT A PAYMENT TAKEN NOW WOULD BUY — said in the renewal dialog, before
 * anybody saves.
 *
 * The dialog used to explain the rule ("renewing while it is still running
 * stacks…") and leave the admin to work the dates out. What was recorded was
 * then whatever the server made of it, and every later renewal stacks onto
 * that date — so it is the one figure on the form that must not come as a
 * surprise. The server is asked (`/plan-window`, the same method the save
 * uses) and this turns its answer into two sentences: the dates, and why.
 */
export interface PlanWindow {
  starts_on: string;
  ends_on: string;
  /** Which rule put the period there. */
  because: "running" | "grace" | "lapsed" | "new_plan" | "first" | "stated";
  /** False when the dates typed end before they start. */
  valid: boolean;
  /** When the period it is on now ends, if it is on one. */
  current_ends_on: string | null;
  grace_ends_on: string | null;
  months: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "1 Sep 2026" — read straight off the date the server sent.
 *
 * Not through `Date`: a calendar date has no timezone, and a laptop west of
 * the server would print the day before. Not through the browser's locale
 * either: one engine writes "Sept" and another "Sep", and these are dates an
 * admin reads back to a shop on the phone.
 */
export function dayOf(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);

  return `${day} ${MONTHS[month - 1] ?? "?"} ${year}`;
}

export function windowSays(w: PlanWindow): { buys: string; why: string; wrong: boolean } {
  if (!w.valid) {
    return {
      buys: `${dayOf(w.starts_on)} → ${dayOf(w.ends_on)} ends before it starts.`,
      why: "Change the dates: a period has to end after it begins.",
      wrong: true,
    };
  }

  const buys = `This buys ${dayOf(w.starts_on)} → ${dayOf(w.ends_on)}.`;
  const was = w.current_ends_on ? dayOf(w.current_ends_on) : null;

  const why = {
    running: `It carries on from ${was ?? "the day the paid period ends"}, so no paid day is lost.`,
    grace: `Its paid period ended on ${was ?? "an earlier day"} and it has been working through its grace days since — those days are part of the period it is paying for now.`,
    lapsed: `Its grace ran out${w.grace_ends_on ? ` on ${dayOf(w.grace_ends_on)}` : ""} and it has been read-only since, so the new period starts today.`,
    new_plan: `A different plan starts a new period today.${was ? ` What is left of the current one (to ${was}) is not carried over — agree the amount with that in mind.` : ""}`,
    first: "It starts today.",
    stated: "These are the dates you typed.",
  }[w.because];

  return { buys, why, wrong: false };
}
