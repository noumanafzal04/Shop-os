import { useCallback, useEffect, useState } from "react";

import Button from "../../components/ui/button/Button";
import { formatEntryDate } from "../../components/ui/filters";
import { useConfirm } from "../../components/ui/confirm";
import { useToast } from "../../components/ui/toast";
import { useAuthStore } from "../../stores/authStore";
import { adoptStranded, strandedReason, strandedRows, type OutboxRow } from "./outbox/outbox";
import { readinessLabel, readOfflineReadiness, type OfflineReadiness } from "./readiness";
import { pullNow } from "./sync/pullNow";

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
  const confirm = useConfirm();
  const toast = useToast();
  const tenantId = useAuthStore((auth) => auth.user?.tenant?.id ?? null);

  const refresh = useCallback(() => {
    void readOfflineReadiness().then(setState, () => setState(null));
    void strandedRows(tenantId).then(setStuck, () => setStuck([]));
  }, [tenantId]);

  useEffect(refresh, [refresh]);

  const save = () => {
    if (saving) return;
    setSaving(true);
    setFailed(false);
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

  return (
    <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-theme-sm font-medium text-gray-800 dark:text-white/90">
            <span
              aria-hidden
              className={`h-2 w-2 shrink-0 rounded-full ${ready ? "bg-success-500" : "bg-warning-500"}`}
            />
            {ready ? "This device can sell offline" : "This device is not ready to sell offline"}
          </p>
          <p className="mt-1 text-theme-xs leading-relaxed text-gray-500 dark:text-gray-400">
            {state === null ? "Checking what is saved here…" : readinessLabel(state)}
          </p>
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

        <Button size="sm" variant="outline" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save everything on this device"}
        </Button>
      </div>

      {/* SALES THIS TILL CANNOT SEND, AND WHY.
          The tenant fence holds a sale that names another shop — or names none,
          because the auth store had not hydrated when Complete was pressed. It
          is right to hold them; what was wrong is that nothing ever said so.
          A shop watched "7 still to send" for days while every press of Sync
          did exactly nothing, correctly and silently. */}
      {stuck.length > 0 && (
        <div className="mt-3 rounded-lg border border-warning-300 bg-warning-50 p-3 dark:border-warning-500/40 dark:bg-warning-500/10">
          <p className="text-theme-sm font-medium text-warning-700 dark:text-warning-400">
            {stuck.length} {stuck.length === 1 ? "sale is" : "sales are"} stuck on this device
          </p>
          <p className="mt-1 text-theme-xs leading-relaxed text-warning-700/80 dark:text-warning-400/80">
            {strandedReason(stuck[0])} Syncing will not move {stuck.length === 1 ? "it" : "them"}.
          </p>
          {stuck.some((r) => r.tenantId == null) && (
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={async () => {
                const orphans = stuck.filter((r) => r.tenantId == null).length;
                const ok = await confirm({
                  title: `File ${orphans} ${orphans === 1 ? "sale" : "sales"} under this shop?`,
                  message:
                    "These were rung on this device but saved without recording which shop they belong to. "
                    + "Only do this if this device has always been used by this shop — the till cannot know, "
                    + "which is why it has not guessed.",
                  confirmLabel: "File them here",
                });
                if (!ok) return;
                const moved = await adoptStranded(tenantId);
                toast.success(`${moved} ${moved === 1 ? "sale" : "sales"} released — press Save to send them.`);
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
