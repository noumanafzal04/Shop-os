import type { SaleDocument } from "../documents/services/documentService";

/**
 * "Sana's clothes — 0300 1234567."
 *
 * A workshop has a handful of cars and reads the board by plate. A laundry has
 * eighty slips, and the customer at the counter gives a name, a phone number or
 * a slip that says JOB-0042. The board had no way to find one: every card had
 * to be read.
 *
 * Matched as typed, ignoring case and anything that is not a letter or a digit,
 * so "0300-1234567", "0300 1234567" and "03001234567" are one number, and
 * "LEA-4291" finds the car stored as LEA4291.
 */
type OnTheBoard = Pick<SaleDocument, "number" | "customer_name" | "customer_phone" | "vehicle">;

const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function findOnBoard<T extends OnTheBoard>(jobs: T[], typed: string): T[] {
  // Nothing typed is "" — which every job's number contains, so the whole board.
  const term = squash(typed);

  return jobs.filter((job) =>
    [job.number, job.customer_name, job.customer_phone, job.vehicle?.registration]
      .some((said) => said != null && squash(said).includes(term)),
  );
}
