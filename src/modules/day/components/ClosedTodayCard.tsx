import { useState } from "react";

import Button from "../../../components/ui/button/Button";
import Label from "../../../components/form/Label";
import TextArea from "../../../components/form/input/TextArea";
import { Modal } from "../../../components/ui/modal";
import type { ClosedToday } from "../services/dayService";

/**
 * TODAY WAS CLOSED OFF — AND THE WAY BACK.
 *
 * "Close off the day" pressed at two in the afternoon, on the wrong screen.
 * No shift can open on a closed day, so a shop that requires a shift to sell
 * had stopped trading until tomorrow — and this screen said "No day open
 * yet", which reads as "nobody has started", the opposite of what happened.
 *
 * So the screen says what happened, who did it and when, and offers to undo
 * it. The server decides whether it can be undone (today's day only, and
 * only while trading has not moved on to a newer one) and whether THIS
 * person may; a button is drawn only when pressing it will work.
 *
 * A reason is asked for and is not optional: a sign-off that was undone with
 * nothing beside it is the first thing an owner reading the trail asks about.
 */

/** The shortest reason the server will take. */
export const SHORTEST_REASON = 3;

interface Props {
  closed: ClosedToday;
  /** The day's date, already written the way this screen writes dates. */
  date: string;
  /** When it was closed, already written as a clock time. */
  closedAt: string;
  money: (n: number) => string;
  busy: boolean;
  onReopen: (reason: string) => Promise<unknown> | void;
}

export default function ClosedTodayCard({ closed, date, closedAt, money, busy, onReopen }: Props) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const ready = reason.trim().length >= SHORTEST_REASON;

  const submit = async () => {
    if (!ready) return;
    await onReopen(reason.trim());
    setAsking(false);
    setReason("");
  };

  return (
    <div
      data-testid="closed-today"
      className="rounded-2xl border border-warning-200 bg-warning-50 p-6 dark:border-warning-500/30 dark:bg-warning-500/10"
    >
      <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
        {date} has been closed off
      </h3>
      <p className="mt-1 text-theme-sm text-gray-600 dark:text-gray-300">
        {closed.branch ? `${closed.branch} · ` : ""}closed at {closedAt}
        {closed.closed_by ? ` by ${closed.closed_by}` : ""} · {money(closed.sales_total)} in sales.
      </p>
      <p className="mt-3 text-theme-sm text-gray-600 dark:text-gray-300">
        No shift can open on a closed day, so the till will not start a new one until tomorrow.
        {closed.can_reopen
          ? " If it was closed by mistake, open it again and carry on — the shifts already counted stay counted."
          : " If it was closed by mistake, a manager can open it again from this screen."}
      </p>

      {closed.can_reopen && (
        <div className="mt-4">
          <Button size="sm" onClick={() => setAsking(true)}>Open today again</Button>
        </div>
      )}

      <Modal isOpen={asking} onClose={() => setAsking(false)} className="max-w-lg p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Open {date} again</h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Shifts can be opened again and the day carries on. Its totals are worked out afresh — from every
          shift, the earlier ones included — when you close it off properly tonight.
        </p>

        <div className="space-y-2">
          <Label>Why is it being opened again?</Label>
          <TextArea
            rows={2}
            value={reason}
            onChange={setReason}
            placeholder="e.g. closed off by mistake at 2 pm"
          />
          <p className="text-theme-xs text-gray-400">
            Kept on the activity trail with your name, beside the figures the day had been closed at.
          </p>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={() => setAsking(false)}>Cancel</Button>
          <Button size="sm" onClick={() => void submit()} disabled={!ready || busy}>
            {busy ? "Opening…" : "Open it again"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
