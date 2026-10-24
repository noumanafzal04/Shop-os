import type { Vehicle } from "./services/vehiclesService";

/**
 * WHAT A CHOSEN PLATE FILLS IN.
 *
 * The owner on file, into boxes the cashier has left empty — never over a name
 * or number somebody typed: the person paying is not always the car's owner,
 * and what the counter typed is the better answer. Null where nothing changes.
 */
export function ownerOf(
  vehicle: Pick<Vehicle, "customer">,
  typedName: string,
  typedPhone: string,
): { name: string | null; phone: string | null } {
  return {
    name: typedName.trim() === "" ? (vehicle.customer?.name ?? null) : null,
    phone: typedPhone.trim() === "" ? (vehicle.customer?.phone ?? null) : null,
  };
}
