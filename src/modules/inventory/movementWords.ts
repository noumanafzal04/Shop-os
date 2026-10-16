import { formatQuantity } from "../../common/format/quantity";
import type { StockMovement } from "./services/inventoryService";

/** What happened, in the words on the line — or the kind of change when nobody wrote any. */
export function movementWhat(m: Pick<StockMovement, "type" | "quantity_change" | "reason">): string {
  if (m.reason) return m.reason;
  if (m.type === "set") return "Recount";

  return Number(m.quantity_change) > 0 ? "Stock in" : "Stock out";
}

/** "+6", "−2", "±0" — the sign a shopkeeper reads, not a hyphen. */
export function movementChange(change: number | string): string {
  const n = Number(change);
  if (n > 0) return `+${formatQuantity(n)}`;
  if (n < 0) return `−${formatQuantity(Math.abs(n))}`;

  return "±0";
}
