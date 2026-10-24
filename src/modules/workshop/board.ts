import type { SaleDocument, WorkStatus } from "../documents/services/documentService";

/** Past the time it was promised for — the one thing on the board worth a colour. */
export function isOverdue(job: Pick<SaleDocument, "promised_at">, now: Date = new Date()): boolean {
  return job.promised_at != null && new Date(job.promised_at) < now;
}

/**
 * THE BOARD IN FOUR NUMBERS, read before any card: how many came in, how many
 * are being worked on, how many are ready to go home — and how many are late,
 * which is the number the phone calls are about.
 */
export function boardTally(
  jobs: Array<Pick<SaleDocument, "work_status" | "promised_at">>,
  now: Date = new Date(),
): Record<WorkStatus, number> & { overdue: number } {
  const at = (s: WorkStatus) => jobs.filter((j) => j.work_status === s).length;

  return {
    received: at("received"),
    in_progress: at("in_progress"),
    ready: at("ready"),
    // A car already ready is waiting on its owner, not on the shop.
    overdue: jobs.filter((j) => j.work_status !== "ready" && isOverdue(j, now)).length,
  };
}

/** A number a phone can ring: "0300-123 4567" → "tel:03001234567". Null for none. */
export function callLink(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/[^\d+]/g, "");

  return digits.length >= 7 ? `tel:${digits}` : null;
}
