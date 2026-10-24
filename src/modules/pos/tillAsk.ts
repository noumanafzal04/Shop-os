/**
 * A BILL FOUND IN SALES, SENT TO THE TILL (Q19, the client 2026-10-17).
 *
 * The customer comes back twenty minutes later with the printed bill. The
 * Sale complete sheet is long gone, so the cashier finds the bill in Sales
 * and sends it to the till — to add two more to it, or to re-ring it. It
 * travels as the router's state, never the address: a reload or a bookmark
 * must not start a re-ring nobody asked for.
 */
export type TillAsk = { addTo: string } | { reRing: string } | { forVehicle: string };

export function tillAskOf(state: unknown): TillAsk | null {
  if (typeof state !== "object" || state === null) return null;
  const ask = state as Record<string, unknown>;
  if (typeof ask.reRing === "string" && ask.reRing !== "") return { reRing: ask.reRing };
  if (typeof ask.addTo === "string" && ask.addTo !== "") return { addTo: ask.addTo };
  // "Bill" on a car's row on Vehicles: the till opens with that car (and its owner) on it.
  if (typeof ask.forVehicle === "string" && ask.forVehicle !== "") return { forVehicle: ask.forVehicle };

  return null;
}
