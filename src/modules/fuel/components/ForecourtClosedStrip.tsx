import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";

import { fuelService } from "../services/fuelService";
import { useAuthStore } from "../../../stores/authStore";
import { INLINE_DISMISS } from "../../../components/ui/modal/closeButton";
import { CloseIcon } from "../../../icons";

/**
 * NO FORECOURT SHIFT IS OPEN — SAID AT THE TILL, NEVER ENFORCED (#P1).
 *
 * A station rang fuel before the morning shift was opened and nothing said a
 * word; the fuel report later called those litres a leak. The report now
 * counts them (the next close takes them), but the meters and the till only
 * line up while a shift is running, so the till says so.
 *
 * A prompt and never a gate: a pump must not stop selling over paperwork — a
 * cashier who cannot ring the sale takes the money and writes it on paper,
 * which loses the sale record as well as the litres.
 */
export function ForecourtClosedStrip() {
  const [dismissed, setDismissed] = useState(false);
  const canOpen = useAuthStore((s) => s.hasPermission("inventory.manage"));
  const state = useQuery({
    queryKey: ["fuel", "open-now"],
    queryFn: async () => (await fuelService.openNow()).data,
    // So it goes away soon after somebody opens a shift on the Forecourt screen.
    refetchInterval: 60_000,
  });

  if (dismissed || !state.data?.forecourt || state.data.open) return null;

  return (
    <div
      data-forecourt-closed
      className="mt-2 flex items-start justify-between gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-theme-xs text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-400"
    >
      <span>
        No forecourt shift is open. Fuel you sell now is still counted, at the next shift&rsquo;s close.{" "}
        {canOpen ? (
          <Link to="/tenant/fuel" className="font-semibold underline">Open a shift</Link>
        ) : (
          "Ask the manager to open one."
        )}
      </span>
      <button type="button" aria-label="Dismiss this message" className={INLINE_DISMISS} onClick={() => setDismissed(true)}>
        <CloseIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
