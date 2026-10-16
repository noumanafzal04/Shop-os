/**
 * THE INSTALLMENT ARITHMETIC, FOR THE FORM'S PREVIEW ONLY (F1).
 *
 * The server works the plan out (`InstallmentSchedule`) and every figure on a
 * plan's page is the server's. The form shows the same sum before anything is
 * sent — "16,000 now + 10 × 5,000 = 66,000" — so it follows the same rules,
 * pinned by the same cases (installments.test.ts / InstallmentScheduleTest):
 *
 *   monthly  what is financed ÷ months, rounded UP to a whole rupee; the last
 *            month takes the rest (to the paisa when whole rupees cannot fit).
 *   dates    the first due date, then the same day each month; a 31st is the
 *            last day of a shorter month and comes back after it.
 */
export function split(financed: number, months: number): { monthly: number; last: number } {
  const f = Math.round(financed * 100) / 100;
  let monthly = Math.ceil(f / months);
  if (months > 1 && monthly * (months - 1) >= f) monthly = Math.floor((f * 100) / months) / 100;

  return { monthly, last: Math.round((f - monthly * (months - 1)) * 100) / 100 };
}

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
