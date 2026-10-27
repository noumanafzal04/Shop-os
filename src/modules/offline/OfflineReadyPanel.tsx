import { useCallback, useEffect, useState } from "react";

import Button from "../../components/ui/button/Button";
import { formatEntryDate } from "../../components/ui/filters";
import { useConfirm } from "../../components/ui/confirm";
import { useToast } from "../../components/ui/toast";
import { useAuthStore } from "../../stores/authStore";
import { adoptStranded, strandedReason, strandedRows, type OutboxRow } from "./outbox/outbox";
import {
  adoptStrandedShiftOps,
  strandedShiftOps,
  type ShiftOpRow,
} from "./shift/shiftQueue";
import { notSavedYet, readinessLabel, readOfflineReadiness, type OfflineReadiness } from "./readiness";
import { markTillHere } from "./device/tillHere";
import { pullNow } from "./sync/pullNow";
import { useQuery } from "@tanstack/react-query";
import { deviceService } from "./device/deviceService";

/**
 * "Save everything on this device", with an answer.
 *
 * A shop turned its wifi off to see whether the till would carry on, got an
 * empty screen, and concluded offline selling did not work. The catalog had in
 * fact been syncing on its own the whole time — on boot, on reconnect, every
 * fifteen minutes — and none of that is visible, so the only way to learn
 * whether a device was ready was to have the outage.
 *
 * Nothing new happens here. This is the sync that already runs, given a
 * button, a count, and a sentence a person can act on: how many products are
 * on this device, whether a scanner will work, and when it last checked.
 *
 * PER DEVICE, and the wording says so. A shop with a counter tablet and an
 * office laptop has two answers, and "your shop is ready" would be true of one
 * of them.
 */
export default function OfflineReadyPanel() {
  const [state, setState] = useState<OfflineReadiness | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [stuck, setStuck] = useState<OutboxRow[]>([]);
  // The OTHER queue. A drawer event is held by the same fence for the same
  // reason, is counted by the same badge, and had no screen of its own.
  const [stuckShifts, setStuckShifts] = useState<ShiftOpRow[]>([]);
  const confirm = useConfirm();
  const toast = useToast();
  const tenantId = useAuthStore((auth) => auth.user?.tenant?.id ?? null);

  const refresh = useCallback(() => {
    void readOfflineReadiness().then(setState, () => setState(null));
    void strandedRows(tenantId).then(setStuck, () => setStuck([]));
    void strandedShiftOps(tenantId).then(setStuckShifts, () => setStuckShifts([]));
  }, [tenantId]);

  useEffect(refresh, [refresh]);

  // WHILE IT SAVES, IT COUNTS. A 50,000-item shop is fifty pages, a minute or
  // more on a slow line, and "Saving…" alone for that long reads as stuck. The
  // device's own count is read again each second as the pages land, so the
  // button says how far it has got.
  useEffect(() => {
    if (!saving) return;
    const tick = setInterval(() => {
      void readOfflineReadiness().then(setState, () => undefined);
    }, 1000);

    return () => clearInterval(tick);
  }, [saving]);

  const save = () => {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    // Asked to be ready, so it is a till from now on (L3): every screen keeps
    // what this saves current, as they do on a device the till was opened on.
    markTillHere(tenantId);
    // Forced: a person pressed this, so anything queued goes now rather than
    // waiting out a backoff. See dueRows.
    void pullNow({ force: true })
      .then(() => setFailed(false), () => setFailed(true))
      .finally(() => {
        setSaving(false);
        refresh();
      });
  };

  const ready = state?.ready === true;
  // Some of the shop's items are not on this device yet — it can sell, but not
  // everything. Said, so a half-finished save is not read as a finished one.
  const partly = ready && state !== null && notSavedYet(state) > 0;
  const onServer = state?.onServer ?? null;
  // How long this shop may sell with no line — its plan's answer. The same
  // query the device list below reads, so it costs nothing more.
  const roster = useQuery({
    queryKey: ["pos-devices"],
    queryFn: () => deviceService.list().then((r) => r.data),
  });
  const offlineDays = roster.data?.offline_days ?? 0;
  // A shop that may sell offline, on a device that cannot yet: the one thing on
  // this tab worth a colour, so it is not missed until the line goes down.
  const urgent = offlineDays > 0 && state !== null && !ready;

  // Said as two nouns rather than one total, because "4 items are stuck" tells
  // a shopkeeper nothing about whether to go looking for money or for a drawer
  // count. The two queues hold different kinds of work and are chased
  // differently.
  const held = stuck.length + stuckShifts.length;
  const orphans =
    stuck.filter((r) => r.tenantId == null).length
    + stuckShifts.filter((r) => r.tenantId == null).length;
  const heldLabel = [
    stuck.length > 0 ? `${stuck.length} ${stuck.length === 1 ? "sale" : "sales"}` : null,
    stuckShifts.length > 0
      ? `${stuckShifts.length} drawer ${stuckShifts.length === 1 ? "event" : "events"}`
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" and ")
    + (held === 1 ? " is" : " are");

  return (
    <div
      data-offline-ready={ready ? "ready" : urgent ? "needed" : "not-ready"}
      className={`rounded-xl border p-4 ${
        urgent
          ? "border-brand-300 bg-brand-50 dark:border-brand-500/40 dark:bg-brand-500/10"
          : ready
            ? "border-success-200 bg-success-50/50 dark:border-success-500/30 dark:bg-success-500/5"
            : "border-gray-200 dark:border-gray-800"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-theme-sm font-medium text-gray-800 dark:text-white/90">
            <span
              aria-hidden
              className={`h-2 w-2 shrink-0 rounded-full ${ready && !partly ? "bg-success-500" : "bg-warning-500"}`}
            />
            {partly
              ? "This device is only partly saved"
              : ready
                ? "This device can sell offline"
                : "This device is not ready to sell offline"}
          </p>
          <p className="mt-1 text-theme-xs leading-relaxed text-gray-500 dark:text-gray-400">
            {state === null ? "Checking what is saved here…" : readinessLabel(state)}
          </p>
          {state !== null && onServer !== null && onServer.products > 0 && state.products < onServer.products && (
            <div
              role="progressbar"
              aria-label="Products saved on this device"
              aria-valuemin={0}
              aria-valuemax={onServer.products}
              aria-valuenow={state.products}
              className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"
            >
              <div
                className="h-full rounded-full bg-brand-500 transition-[width] duration-500"
                style={{ width: `${Math.floor((state.products / onServer.products) * 100)}%` }}
              />
            </div>
          )}
          {urgent && (
            <p className="mt-1 text-theme-xs font-medium text-brand-700 dark:text-brand-300">
              Your plan lets this shop sell without internet for up to {offlineDays} day{offlineDays === 1 ? "" : "s"}. Save this device so it can.
            </p>
          )}
          {state?.lastPullAt && (
            <p className="mt-1 text-theme-xs text-gray-400">
              Last checked {formatEntryDate(state.lastPullAt)}
            </p>
          )}
          {failed && (
            <p className="mt-1 text-theme-xs text-error-600 dark:text-error-400">
              Couldn't reach the server. What was already saved is still here.
            </p>
          )}
        </div>

        <Button size="sm" variant={ready ? "outline" : "primary"} onClick={save} disabled={saving}>
          {saving
            ? state !== null && onServer !== null && onServer.products > 0
              ? `Saving… ${Math.min(state.products, onServer.products).toLocaleString()} of ${onServer.products.toLocaleString()}`
              : "Saving…"
            : "Save everything on this device"}
        </Button>
      </div>

      {/* SALES THIS TILL CANNOT SEND, AND WHY.
          The tenant fence holds a sale that names another shop — or names none,
          because the auth store had not hydrated when Complete was pressed. It
          is right to hold them; what was wrong is that nothing ever said so.
          A shop watched "7 still to send" for days while every press of Sync
          did exactly nothing, correctly and silently. */}
      {held > 0 && (
        <div className="mt-3 rounded-lg border border-warning-300 bg-warning-50 p-3 dark:border-warning-500/40 dark:bg-warning-500/10">
          <p className="text-theme-sm font-medium text-warning-700 dark:text-warning-400">
            {heldLabel} stuck on this device
          </p>
          <p className="mt-1 text-theme-xs leading-relaxed text-warning-700/80 dark:text-warning-400/80">
            {strandedReason(stuck[0] ?? stuckShifts[0])} Syncing will not move {held === 1 ? "it" : "them"}.
          </p>
          {orphans > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={async () => {
                const ok = await confirm({
                  title: `File ${orphans} ${orphans === 1 ? "item" : "items"} under this shop?`,
                  message:
                    "These were rung on this device but saved without recording which shop they belong to. "
                    + "Only do this if this device has always been used by this shop — the till cannot know, "
                    + "which is why it has not guessed.",
                  confirmLabel: "File them here",
                });
                if (!ok) return;
                // Both queues, or a shop adopts its sales and stays stuck on a
                // drawer event it was never shown.
                const moved = (await adoptStranded(tenantId)) + (await adoptStrandedShiftOps(tenantId));
                toast.success(`${moved} ${moved === 1 ? "item" : "items"} released — press Save to send them.`);
                refresh();
              }}
            >
              File them under this shop
            </Button>
          )}
        </div>
      )}

      <p className="mt-3 border-t border-gray-100 pt-3 text-theme-xs leading-relaxed text-gray-400 dark:border-gray-800">
        {/* The honest limit, said before it is discovered. The catalog is
            saved; the app itself is cached by the browser on first use, so a
            device that has never opened the till while online has nothing to
            open when it goes offline. */}
        Do this once on each device before you need it — a tablet at the counter and a laptop in the
        office each keep their own copy. Open the till at least once while you have a connection, so
        the app itself is stored too.
      </p>
    </div>
  );
}
