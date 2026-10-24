import { getAll } from "../db/repo";
import { STORE } from "../db/schema";
import type { CatalogCustomer, CatalogVehicle } from "../sync/catalogService";
import type { Vehicle } from "../../vehicles/services/vehiclesService";

/**
 * A plate, found with no server (#39).
 *
 * With the line down the till's lookup asked the server, heard nothing, and
 * showed what it shows for a plate nobody has seen: "+ Register JW-0011" — an
 * invitation to add, as a new car, a van the shop had serviced for a year.
 * The customers were on the device; their cars were not.
 *
 * It answers the way the online lookup does (VehicleController::index): the
 * plate however it was typed — "jw 0011", "JW-0011" and "JW0011" are one car,
 * because the server stores them normalised — or the make or model. The owner
 * comes from the customers already on the device; nothing is stored twice.
 */
export async function vehiclesOnDevice(search: string, limit = 10): Promise<Vehicle[]> {
  const typed = search.trim();
  const plate = typed.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const words = typed.toLowerCase();
  if (typed.length < 2) return [];

  const [cars, customers] = await Promise.all([
    getAll<CatalogVehicle>(STORE.VEHICLES),
    getAll<CatalogCustomer>(STORE.CUSTOMERS),
  ]);
  const owners = new Map(customers.map((c) => [c.id, c]));

  const hits = cars.filter((car) =>
    (plate !== "" && car.registration.includes(plate))
    || (car.make ?? "").toLowerCase().includes(words)
    || (car.model ?? "").toLowerCase().includes(words),
  );

  // Plates that start with what was typed come first — the exact plate first
  // among them, since it sorts before every longer one — then the rest: the
  // cashier taps the first row.
  const rank = (car: CatalogVehicle) => (car.registration.startsWith(plate) ? 0 : 1);

  return hits
    .sort((a, b) => rank(a) - rank(b) || a.registration.localeCompare(b.registration))
    .slice(0, limit)
    .map((car) => {
      const owner = car.customer_id === null ? undefined : owners.get(car.customer_id);

      return {
        id: car.id,
        registration: car.registration,
        customer_id: car.customer_id,
        customer: owner ? { id: owner.id, name: owner.name, phone: owner.phone } : null,
        make: car.make,
        model: car.model,
        year: car.year,
        colour: car.colour,
        tyre_size: car.tyre_size,
        odometer: car.odometer,
        engine_no: null,
        chassis_no: null,
        odometer_at: null,
        notes: null,
        is_active: true,
      };
    });
}
