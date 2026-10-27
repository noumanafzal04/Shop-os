import type { SaleDocument, WorkStatus } from "../documents/services/documentService";

/** Past the time it was promised for — the one thing on the board worth a colour. */
export function isOverdue(job: Pick<SaleDocument, "promised_at">, now: Date = new Date()): boolean {
  return job.promised_at != null && new Date(job.promised_at) < now;
}

/** Late on the shop: past its time and not ready. A car already ready is waiting on its owner. */
export function isLate(job: Pick<SaleDocument, "work_status" | "promised_at">, now: Date = new Date()): boolean {
  return job.work_status !== "ready" && isOverdue(job, now);
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
    overdue: jobs.filter((j) => isLate(j, now)).length,
  };
}

const ORDER: WorkStatus[] = ["received", "in_progress", "ready"];

/**
 * ONE PRESS FORWARD, ONE BACK.
 *
 * A card offered "→" to every other stage, so a mechanic read three look-alike
 * buttons to do the one obvious thing. The card now offers the next step and
 * the step back (a job marked ready fails its road test); a jump across stages
 * is still there, in the job's own sheet. Ready has no next stage — its next
 * step is the bill.
 */
export function cardMoves(stage: WorkStatus): { next: WorkStatus | null; back: WorkStatus | null } {
  const i = ORDER.indexOf(stage);

  return { next: ORDER[i + 1] ?? null, back: ORDER[i - 1] ?? null };
}

/** A number a phone can ring: "0300-123 4567" → "tel:03001234567". Null for none. */
export function callLink(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/[^\d+]/g, "");

  return digits.length >= 7 ? `tel:${digits}` : null;
}
