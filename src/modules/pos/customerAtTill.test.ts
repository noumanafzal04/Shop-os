import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { putMany } from "../offline/db/repo";
import { STORE } from "../offline/db/schema";
import { resetDbCache } from "../offline/db/open";
import { memberDiscountFor, memberGroupFor } from "../offline/lookup/memberDiscount";
import { groupAtTill } from "./customerAtTill";

/**
 * WHO IS AT THE COUNTER, as far as the bill is concerned.
 *
 * The sale finds a customer's group by their phone number and acts on it. The
 * till has to find the SAME group by the same number, online and off, or the
 * figure on the screen is a figure about somebody else.
 */

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
});

describe("a group as the bill needs it", () => {
  it("keeps what changes the bill", () => {
    expect(groupAtTill({ name: "Trade", price_level: "wholesale", discount_percent: "5.00" }))
      .toEqual({ name: "Trade", price_level: "wholesale", discount_percent: 5 });
  });

  it("is nothing when it changes nothing — a retail group with no percentage", () => {
    expect(groupAtTill({ name: "Regulars", price_level: "retail", discount_percent: null })).toBeNull();
    expect(groupAtTill(null)).toBeNull();
    // An older server that never sent the field.
    expect(groupAtTill(undefined)).toBeNull();
  });

  it("never invents a level it was not given", () => {
    expect(groupAtTill({ name: "Odd", price_level: "vip", discount_percent: 10 })?.price_level).toBe("retail");
  });
});

describe("offline, the group is found the way the sale will find it", () => {
  beforeEach(async () => {
    await putMany(STORE.CUSTOMER_GROUPS, [
      { id: "g-trade", name: "Trade", price_level: "wholesale", discount_percent: 0 },
    ]);
    await putMany(STORE.CUSTOMERS, [
      { id: "c-1", name: "Bilal Traders", phone: "03001234567", customer_group_id: "g-trade" },
    ]);
  });

  it("by the exact number", async () => {
    expect((await memberGroupFor(" 03001234567 "))?.id).toBe("g-trade");
  });

  it("NOT by a number that only ends the same — the sale would not match it", async () => {
    /**
     * `memberDiscountFor` matches the last ten digits, and may: it only ever
     * refuses. This one PRICES. A line rung at wholesale for +92300… syncs as
     * a sale the server prices at retail, short by the difference.
     */
    expect(await memberGroupFor("+923001234567")).toBeNull();
    // …while the refusal side still recognises the member, deliberately.
    await putMany(STORE.CUSTOMER_GROUPS, [
      { id: "g-trade", name: "Trade", price_level: "wholesale", discount_percent: 10 },
    ]);
    expect(await memberDiscountFor("+923001234567")).toBe(10);
  });

  it("nobody for a walk-in", async () => {
    expect(await memberGroupFor("")).toBeNull();
    expect(await memberGroupFor("03009999999")).toBeNull();
  });
});
