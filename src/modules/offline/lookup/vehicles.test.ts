import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { resetDbCache } from "../db/open";
import { vehiclesOnDevice } from "./vehicles";
import { applyPull } from "../sync/applyPull";
import type { CatalogCustomer, CatalogPull, CatalogVehicle, Page, Tombstone } from "../sync/catalogService";

/**
 * A PLATE ON FILE IS FOUND WITH NO LINE (#39).
 *
 * Offline, a van the shop already had came back "not found" and the till
 * offered to register it again. The cars now travel with the catalogue, and
 * are found the way the online lookup finds them.
 */

const page = <T,>(items: Array<T | Tombstone>): Page<T> => ({ items, cursor: "c1", has_more: false });

const car = (over: Partial<CatalogVehicle> & { id: string; registration: string }): CatalogVehicle => ({
  customer_id: null, make: null, model: null, year: null, colour: null, tyre_size: null, odometer: null, ...over,
});

const pull = (cars: Array<CatalogVehicle | Tombstone>, customers: CatalogCustomer[] = []): CatalogPull => ({
  products: page([]),
  categories: page([]),
  promotions: page([]),
  tax_groups: page([]),
  customer_groups: page([]),
  customers: page(customers),
  vehicles: page(cars),
  settings: {},
  offline_days: 3,
  offline_selling: true,
  offline_hard_stop_days: null,
  timezone: "Asia/Karachi",
  server_time: new Date().toISOString(),
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
});

describe("finding a car with no server", () => {
  beforeEach(async () => {
    await applyPull(pull(
      [
        car({ id: "v1", registration: "JW0011", customer_id: "c1", make: "Suzuki", model: "Bolan", tyre_size: "165/80 R13" }),
        car({ id: "v2", registration: "JW0012", customer_id: "c1" }),
        car({ id: "v3", registration: "LEA4291", make: "Toyota", model: "Corolla" }),
        // Holds "JW0011" inside it and sorts before it by name.
        car({ id: "v4", registration: "AJW0011" }),
      ],
      [{ id: "c1", name: "Al-Rehman Traders", phone: "03001112222", customer_group_id: null }],
    ));
  });

  it("finds the plate however the counter typed it", async () => {
    for (const typed of ["JW-0011", "jw 0011", "JW0011"]) {
      const [first] = await vehiclesOnDevice(typed);
      expect(first?.id, `${typed} was not found`).toBe("v1");
    }
  });

  it("brings the owner from the customers on the device", async () => {
    const [van] = await vehiclesOnDevice("JW-0011");

    expect(van.customer).toEqual({ id: "c1", name: "Al-Rehman Traders", phone: "03001112222" });
    expect(van.tyre_size).toBe("165/80 R13");
  });

  it("puts the exact plate first", async () => {
    const found = await vehiclesOnDevice("JW-0011");
    expect(found.map((v) => v.id)).toEqual(["v1", "v4"]);
  });

  it("finds by make or model, as the online lookup does", async () => {
    expect((await vehiclesOnDevice("corolla")).map((v) => v.id)).toEqual(["v3"]);
  });

  it("a plate not on file is not found — and that is the only case", async () => {
    expect(await vehiclesOnDevice("ABC-1234")).toEqual([]);
  });

  it("a car removed at the shop leaves the till", async () => {
    await applyPull(pull([{ id: "v1", deleted: true }]));
    expect((await vehiclesOnDevice("JW-0011")).map((v) => v.id)).toEqual(["v4"]);
  });
});
