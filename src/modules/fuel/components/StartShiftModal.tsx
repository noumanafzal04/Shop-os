import { useMemo, useState } from "react";

import Button from "../../../components/ui/button/Button";
import { Modal } from "../../../components/ui/modal";
import { useStaffModule } from "../../staff/hooks/useStaff";
import { useFuelPumps } from "../hooks/useFuel";

/**
 * Who is on which hose tonight.
 *
 * ── The only question this screen asks ──────────────────────────────────
 *
 * Not the meters. Those are already where the last shift left them, and the
 * shift opens on exactly that — the one value that keeps the series unbroken.
 * Asking a manager to key them in again at 6am would invite a typo into the
 * one number the whole reconciliation is measured from.
 *
 * So it asks the single thing the equipment cannot know: which man is standing
 * at which nozzle. That answer is what turns "forty litres unbilled" into
 * "forty litres unbilled, on Ali's nozzles" — the version somebody can act on
 * the same evening, which is the only evening it can be acted on.
 *
 * ── Nobody is a real answer ─────────────────────────────────────────────
 *
 * Most stations here are one man and two hoses, and he is not going to hand
 * himself a shortfall report. Every dropdown starts at nobody and stays there
 * if it is left alone; the shift opens either way. A screen that refused to
 * start until four names were entered would be a screen managers learn to
 * route around, and then the meters never get read at all.
 */

interface Props {
  onClose: () => void;
  onStart: (readings: Array<{ fuel_nozzle_id: string; attendant_id: string }>) => void;
  busy: boolean;
}

export function StartShiftModal({ onClose, onStart, busy }: Props) {
  const pumps = useFuelPumps();
  const { useStaffList } = useStaffModule("/staff");
  const staff = useStaffList({ status: "active" });

  /** nozzle id → attendant id. Absent means nobody, which is the default. */
  const [assigned, setAssigned] = useState<Record<string, string>>({});

  // Only what the shift will actually open on: an inactive nozzle is not part
  // of the night, and offering it here would let somebody assign a man to a
  // hose that never appears on the close.
  const live = useMemo(
    () =>
      (pumps.data ?? [])
        .filter((p) => p.is_active)
        .map((p) => ({ pump: p, nozzles: (p.nozzles ?? []).filter((n) => n.is_active) }))
        .filter((row) => row.nozzles.length > 0),
    [pumps.data],
  );

  const people = staff.data?.data ?? [];
  const namedCount = Object.values(assigned).filter((v) => v !== "").length;

  const start = () =>
    onStart(
      Object.entries(assigned)
        .filter(([, attendant]) => attendant !== "")
        .map(([fuel_nozzle_id, attendant_id]) => ({ fuel_nozzle_id, attendant_id })),
    );

  return (
    <Modal isOpen onClose={onClose} className="max-w-lg p-6">
      <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Start a shift</h3>
      <p className="mb-4 text-theme-xs text-gray-500 dark:text-gray-400">
        The meters open where the equipment already stands. The only thing to say is who is on
        which hose — and that is optional.
      </p>

      <div className="max-h-[55dvh] space-y-4 overflow-y-auto pr-1">
        {pumps.isLoading ? (
          <div className="h-32 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
        ) : live.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 py-8 text-center text-theme-xs text-gray-400 dark:border-gray-700">
            No active nozzles are set up. A shift cannot open without them.
          </p>
        ) : (
          live.map(({ pump, nozzles }) => (
            <div key={pump.id}>
              <p className="mb-1.5 text-theme-xs font-medium uppercase tracking-wide text-gray-400">
                {pump.name}
              </p>
              <div className="space-y-1.5">
                {nozzles.map((n) => (
                  <div key={n.id} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 truncate text-sm text-gray-700 dark:text-gray-200">
                      {n.name}
                    </span>
                    {/* A plain select, not the shared one: "nobody" has to stay
                        reachable after a name has been picked, and the shared
                        placeholder is disabled by design. */}
                    <select
                      value={assigned[n.id] ?? ""}
                      onChange={(e) => setAssigned((s) => ({ ...s, [n.id]: e.target.value }))}
                      className="h-9 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                    >
                      <option value="">Nobody assigned</option>
                      {people.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <p className="mt-4 text-theme-xs text-gray-400">
        {namedCount === 0
          ? "Nobody named — the close will report the station as a whole."
          : `${namedCount} nozzle${namedCount === 1 ? "" : "s"} named. The close will say what each man's litres came to.`}
      </p>

      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={busy} onClick={start}>
          {busy ? "Opening…" : "Start shift"}
        </Button>
      </div>
    </Modal>
  );
}
