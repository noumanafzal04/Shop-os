import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import { posService } from "../services/posService";
import { sellersOnDevice } from "../../offline/tillSettings";

/**
 * Who sold this, where the floor and the counter are two different jobs.
 *
 * ── Why the till asks at all ────────────────────────────────────────────
 *
 * The staff report groups sales by who ENTERED them. In a one-person shop that
 * is also who sold them. In a garment or electronics showroom it is the cashier
 * — so the report credited one person with everybody's month, and the salesmen
 * who actually did the work appeared nowhere on it.
 *
 * Nothing in a sale can tell you who walked the customer round the shop. It has
 * to be said, once, at the till.
 *
 * ── The person at the till is the default ────────────────────────────────
 *
 * The user, 2026-10-21: it opens on the signed-in person when they are one of
 * the sellers — most sales are sold by whoever rings them — and stays
 * changeable to a colleague or to Nobody. Un-naming is never re-seeded: once
 * Nobody is picked on this sheet, Nobody is what is sent.
 *
 * ── Absent, not disabled ────────────────────────────────────────────────
 *
 * Most shops on this platform are one counter and one person. They never switch
 * this on, so they never see it: a picker on every sale, in a shop where the
 * answer is always the same, is a slower till bought with nothing.
 */

interface Props {
  /** Has the shop asked for this? Comes from `pos_ask_who_served`. */
  enabled: boolean;
  /** Who is signed in — the default when they are one of the sellers. */
  me: string | null;
  /**
   * May they name a colleague (`sales.credit_others`)? Without it the list is
   * themselves alone — the staff report pays off this name, and a cashier
   * could put any sale on anybody's month (the user, 2026-10-21). The server
   * refuses it too.
   */
  anyone: boolean;
  value: string | null;
  onChange: (id: string | null) => void;
}

export function ServedByRow({ enabled, me, anyone, value, onChange }: Props) {
  const sellers = useQuery({
    queryKey: ["pos", "sellers"],
    // The server's list, or — with no line — the one that came down with the
    // catalogue. A box that vanished offline sent every salon sale with nobody
    // named (services #S5).
    queryFn: async () => {
      try {
        return (await posService.sellers()).data;
      } catch (failed) {
        const kept = await sellersOnDevice();
        if (kept.length > 0) return kept;
        throw failed;
      }
    },
    enabled,
    // Staff lists change on the day somebody is hired, not between customers.
    staleTime: 30 * 60 * 1000,
  });

  const everyone = sellers.data ?? [];
  const people = anyone ? everyone : everyone.filter((p) => p.id === me);
  const meSells = me !== null && people.some((p) => p.id === me);
  // Seeded once per sheet, and only from nothing.
  const seeded = useRef(false);
  useEffect(() => {
    if (!enabled || seeded.current || !meSells) return;
    seeded.current = true;
    if (value === null) onChange(me);
  }, [enabled, meSells, me, value, onChange]);

  if (!enabled || people.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="served-by" className="shrink-0 text-theme-sm font-medium text-gray-600 dark:text-gray-300">
          Served by
        </label>
        <select
          id="served-by"
          value={value ?? ""}
          onChange={(e) => { seeded.current = true; onChange(e.target.value === "" ? null : e.target.value); }}
          className="h-11 w-full max-w-[15rem] rounded-xl border border-gray-300 bg-white px-3 text-theme-sm text-gray-800 focus:border-brand-400 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
        >
          {/* Selectable, not a disabled placeholder: un-naming somebody has to
              stay possible after a name has been picked by mistake. */}
          {anyone && <option value="">Nobody</option>}
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <p className="mt-1 text-right text-[11px] text-gray-400">
        {anyone ? "Who sold it — you, unless a colleague walked the customer round." : "Your own sales only — naming a colleague needs a manager."}
      </p>
    </div>
  );
}
