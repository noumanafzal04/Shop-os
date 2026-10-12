import { useState } from "react";
import { Link } from "react-router";

import Button from "../../../components/ui/button/Button";
import { Modal, ModalForm } from "../../../components/ui/modal";
import type { OwnerOrder, Rider } from "../services/ordersService";
import { carryingNow, whoCanCarry } from "../whoCarries";

/**
 * THE QUESTION "OUT FOR DELIVERY" ASKS — see `whoCarries.ts` for why it asks.
 *
 * The shop's riders, the freest first, each one press; and beside them, always,
 * "Send without a rider". A shop that has made no rider is told where riders
 * are made, and is not stopped: the order still goes out.
 *
 * Closing the sheet is NOT an answer. The order stays where it was — a step
 * that sends food out of the door is not taken by pressing Escape.
 */
export function WhoCarriesIt({ order, riders, busy, onClose, onSend }: {
  /** The order about to leave, or null when nothing is being asked. */
  order: OwnerOrder | null;
  riders: Rider[];
  busy: boolean;
  onClose: () => void;
  /** Send it — with this rider, or with nobody (`null`). */
  onSend: (riderId: string | null) => void;
}) {
  // What was picked, and for WHICH order: the last one's rider is not this one's.
  const [picked, setPicked] = useState<{ order: string; rider: string } | null>(null);
  const offered = whoCanCarry(riders);

  if (order === null) return <Modal isOpen={false} onClose={onClose}><span /></Modal>;

  // With one rider there is nothing to choose between, so they are chosen.
  const only = offered.length === 1 ? offered[0].id : null;
  const chosen = picked?.order === order.id ? picked.rider : only;
  const who = offered.find((r) => r.id === chosen) ?? null;

  return (
    <Modal isOpen onClose={onClose} className="max-w-md">
      <ModalForm
        title={`Who is carrying ${order.order_number}?`}
        description={`${order.customer_name ?? "The customer"} is told it is on the way${order.delivery_address ? ` to ${order.delivery_address}` : ""}.`}
        footer={
          // One above the other on a phone — a rider's name is as long as it
          // is, and two buttons side by side pushed the first off the sheet.
          <div className="flex w-full flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            {/* Always here, and never the lesser button when there is nobody to choose. */}
            <Button size="sm" className="w-full sm:w-auto" variant={offered.length === 0 ? "primary" : "outline"} disabled={busy} onClick={() => onSend(null)}>
              Send without a rider
            </Button>
            {offered.length > 0 && (
              <Button size="sm" className="w-full min-w-0 sm:w-auto" disabled={busy || who === null} onClick={() => onSend(who?.id ?? null)}>
                <span className="truncate">{who === null ? "Choose a rider" : `Send with ${who.name}`}</span>
              </Button>
            )}
          </div>
        }
      >
        {offered.length === 0 ? (
          <div data-testid="no-riders" className="rounded-xl border border-dashed border-gray-300 px-4 py-5 text-center dark:border-gray-700">
            <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">This shop has no riders yet.</p>
            <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
              The order can still go out. To put a name on the next one,{" "}
              <Link to="/tenant/riders" className="font-medium text-brand-500 hover:text-brand-600">add a rider</Link>.
            </p>
          </div>
        ) : (
          <div role="radiogroup" aria-label="Rider" className="space-y-2">
            {offered.map((r) => {
              const on = chosen === r.id;
              const out = (r.active_deliveries ?? 0) > 0;

              return (
                <button
                  key={r.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={busy}
                  onClick={() => setPicked({ order: order.id, rider: r.id })}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-xl border-2 px-3.5 py-2.5 text-left transition disabled:opacity-60 ${
                    on
                      ? "border-brand-500 bg-brand-50 dark:bg-brand-500/15"
                      : "border-gray-200 hover:border-brand-300 dark:border-gray-700 dark:hover:border-brand-500/50"
                  }`}
                >
                  <span aria-hidden="true" className={`grid size-5 shrink-0 place-items-center rounded-full border-2 ${on ? "border-brand-500" : "border-gray-300 dark:border-gray-600"}`}>
                    {on && <span className="size-2.5 rounded-full bg-brand-500" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-theme-sm font-semibold text-gray-800 dark:text-white/90">{r.name}</span>
                    {r.phone && <span className="block truncate text-theme-xs text-gray-500 dark:text-gray-400">{r.phone}</span>}
                  </span>
                  <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-theme-xs font-medium ${
                    out
                      ? "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400"
                      : "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400"
                  }`}>
                    {carryingNow(r)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </ModalForm>
    </Modal>
  );
}
