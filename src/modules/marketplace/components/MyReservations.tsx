import { useState } from "react";

import Badge from "../../../components/ui/badge/Badge";
import Button from "../../../components/ui/button/Button";
import Pager from "../../../components/ui/pager";
import { useToast } from "../../../components/ui/toast";
import { useCancelReservation, useMyReservations } from "../hooks/useMarketplace";
import type { CustomerReservation } from "../services/marketplaceService";

/**
 * Things a buyer has asked a shop to hold for them.
 *
 * ── Why this was missing, and what it cost ─────────────────────────────
 *
 * The shop's half of reservations is complete: a list, accept, reject, complete,
 * and stock actually held on accept. The buyer's half was built on the server —
 * list, create, cancel — and then only `create` was ever called.
 *
 * So a customer could ask a shop to hold a fridge and then had no way to look at
 * it, no way to see whether it had been accepted, and no way to cancel. Both
 * sides lose from that: the buyer chases the shop by phone, and the shop holds
 * stock off its own shelf for somebody who changed their mind a week ago.
 *
 * ── Why it sits under the orders page rather than on its own ───────────
 *
 * Most buyers have none, ever — reservations are a retail thing, and a shop has
 * to have the module. A menu entry that is empty for nine people in ten is a
 * menu entry nobody reads. This renders NOTHING at all when the list is empty,
 * so it costs an unaffected buyer no space and no attention.
 */

const STATUS_COLOR: Record<string, "success" | "warning" | "info" | "error" | "light"> = {
  pending: "warning",
  accepted: "info",
  completed: "success",
  rejected: "error",
  cancelled: "error",
  expired: "light",
};

/** What the status means to the person waiting, not to the shop. */
const STATUS_WORDS: Record<string, string> = {
  pending: "Waiting for the shop",
  accepted: "Being held for you",
  completed: "Collected",
  rejected: "The shop couldn't hold it",
  cancelled: "Cancelled",
  expired: "Hold ran out",
};

const money = (n: string | number) => `Rs ${Number(n).toLocaleString()}`;

/** The shop can still be talked out of it while it is one of these. */
const cancellable = (r: CustomerReservation) => r.status === "pending" || r.status === "accepted";

export function MyReservations() {
  const [page, setPage] = useState(1);
  const reservations = useMyReservations(true, page);
  const cancel = useCancelReservation();
  const toast = useToast();

  const rows = reservations.data?.data ?? [];
  const pagination = reservations.data?.meta?.pagination;

  // Nothing at all rather than an empty-state card. A buyer who has never
  // reserved anything should not have to learn what a reservation is.
  if (reservations.isLoading || rows.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="mb-4 text-lg font-bold text-gray-800 dark:text-white/90">Items held for you</h2>

      <div className="space-y-3">
        {rows.map((r) => (
          <div
            key={r.id}
            className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-gray-800 dark:text-white/90">
                  {r.product_name}
                  {r.variant_name && <span className="text-gray-400"> · {r.variant_name}</span>}
                </p>
                <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                  {r.shop.business_name} · {r.quantity} × {money(r.unit_price)}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Badge color={STATUS_COLOR[r.status] ?? "light"}>
                  {STATUS_WORDS[r.status] ?? r.status}
                </Badge>

                {cancellable(r) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={cancel.isPending}
                    onClick={() =>
                      cancel.mutate(r.id, {
                        onSuccess: () => toast.success("Reservation cancelled"),
                        onError: () =>
                          toast.error("That couldn't be cancelled — the shop may have completed it already."),
                      })
                    }
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>

            {/* Only while it is actually being held — a date on a cancelled row
                reads as though something is still counting down. */}
            {r.status === "accepted" && r.expires_at && (
              <p className="mt-2 text-theme-xs text-gray-400">
                Held until {new Date(r.expires_at).toLocaleDateString()}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* The shared pager, so nobody writes another. There are only ever a
          handful of these, and the shop's own reservations screen has had one
          all along — this list is the customer's side of the same rows. */}
      <Pager pagination={pagination} onPage={setPage} noun="reservations" />
    </section>
  );
}
