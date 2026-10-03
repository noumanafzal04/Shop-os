import React from "react";
import { ChipBar } from "@cartze/core/ui/ChipBar";
import { STATUS_LABEL, type OrderStatus } from "../services/orderStages";
import type { StageCounts } from "../services/ordersService";

/** Left to right in the order an order actually travels. */
const STAGES: Array<OrderStatus | "all"> = [
  "all",
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "out_for_delivery",
  "completed",
];

/**
 * WHICH STAGE THE QUEUE IS SHOWING, AND HOW MANY ARE IN EACH.
 *
 * The pills themselves are `ChipBar` — one copy, in core, after this app grew
 * three of them and two rendered broken. What belongs here is only WHICH
 * stages, in what order, and where the numbers come from.
 *
 * ── The count is always drawn, including zero ────────────────────────
 *
 * The server computes these with conditional sums rather than a GROUP BY for
 * exactly this reason: a missing key would leave one chip with no number
 * beside six that have one, and "no number" reads as "not counted", not as
 * "none". A shopkeeper glancing at this has to be able to trust that an empty
 * stage says 0 rather than saying nothing.
 */
export function StageBar({
  active,
  counts,
  onPick,
}: {
  active: OrderStatus | "all";
  counts: StageCounts | undefined;
  onPick: (stage: OrderStatus | "all") => void;
}) {
  return (
    <ChipBar
      active={active}
      onPick={onPick}
      items={STAGES.map((stage) => ({
        key: stage,
        label: stage === "all" ? "All" : STATUS_LABEL[stage],
        count: counts?.[stage],
      }))}
    />
  );
}
