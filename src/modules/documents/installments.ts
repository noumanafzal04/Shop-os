/**
 * INSTALLMENT DATES (F1).
 *
 * The plan's money — the monthly amount, the last month — is the SERVER's
 * (`InstallmentSchedule`), and the form reads it out from
 * POST /installment-plans/worth. It once worked it out here, from shelf prices
 * before tax, and read out a bill short of the plan written (money pass
 * 2026-10-16, $8). What stays here is the calendar:
 *
 *   dates    the first due date, then the same day each month; a 31st is the
 *            last day of a shorter month and comes back after it.
 */
/** Month `n` (1 = the first)'s due date, as YYYY-MM-DD — no clock, no zone. */
export function dueOn(first: string, n: number): string {
  const [y, m, d] = first.slice(0, 10).split("-").map(Number);
  const months = (m - 1) + (n - 1);
  const year = y + Math.floor(months / 12);
  const month = (months % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (v: number) => String(v).padStart(2, "0");

  return `${year}-${pad(month)}-${pad(Math.min(d, lastDay))}`;
}

/** The day it falls due each month, under the monthly amount: "on the 16th". */
export function dueDayWords(first: string): string {
  const d = Number(first.slice(8, 10));
  const tens = d % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[d % 10] ?? "th";

  return d > 28 ? `on the ${d}${suffix} or last day` : `on the ${d}${suffix}`;
}

/** A month later than `date` (the form's first-due default), on the same rule. */
export const aMonthAfter = (date: string): string => dueOn(date, 2);

export type MonthState = "paid" | "late" | "due" | "upcoming";

export interface PlanStanding {
  rows?: Array<{ n: number; due_on: string; amount: number; paid: number; state: MonthState }>;
  paid: number;
  left: number;
  late: number;
  late_months: number;
  due_now: number;
  next_due_on: string | null;
  months_paid: number;
}

/** Whole days from `today` to `date` (both YYYY-MM-DD); negative when it has passed. */
export function daysUntil(date: string, today: string): number {
  const utc = (d: string) => {
    const [y, m, day] = d.slice(0, 10).split("-").map(Number);

    return Date.UTC(y, m - 1, day);
  };

  return Math.round((utc(date) - utc(today)) / 86_400_000);
}

/** "today", "in 3 days", "tomorrow" — for a date that has not passed. */
export function whenDue(date: string, today: string): string {
  const d = daysUntil(date, today);

  return d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
}
