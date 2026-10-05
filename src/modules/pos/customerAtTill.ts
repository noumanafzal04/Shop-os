import type { BillGroup } from "./tillBill";

/** What `/customers-lookup` says about the person at the counter. */
export interface CustomerAtTill {
  id: string;
  name: string;
  phone: string;
  loyalty_points: number;
  /** Absent from a server older than the field; null for no group. */
  group?: GroupAtTill | null;
}

export interface GroupAtTill {
  name: string;
  price_level: string;
  discount_percent: number | string | null;
}

/**
 * A group as the bill needs it — or null when it would change nothing.
 *
 * Shared by the online lookup and the offline copy, which spell the same
 * group slightly differently (a decimal arrives as a string from one of
 * them), so the bill can never be handed a level it does not know.
 */
export function groupAtTill(group: GroupAtTill | null | undefined): (BillGroup & { name: string }) | null {
  if (group == null) return null;

  const pct = Number(group.discount_percent ?? 0);
  const level = group.price_level === "wholesale" ? "wholesale" : "retail";
  if (level === "retail" && !(pct > 0)) return null;

  return { name: group.name, price_level: level, discount_percent: pct > 0 ? pct : 0 };
}
