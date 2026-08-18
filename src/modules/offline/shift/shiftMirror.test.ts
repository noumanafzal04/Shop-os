import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { resetDbCache } from "../db/open";
import { getAll } from "../db/repo";
import { STORE } from "../db/schema";
import { mirrorShift, mirroredShift, type MirroredShift } from "./shiftMirror";
import type { CashSession } from "../../pos/services/posService";

/**
 * The shift a till is standing at, kept where a reload cannot lose it.
 *
 * The POS refuses to tender without an open shift, and the open shift used to
 * live in a react-query cache and nowhere else. An outage sold fine while the
 * page stayed mounted; a reload — a sleeping tablet, a PWA relaunch, a power
 * cut — left the whole offline module behind a gate that needed the server.
 */

const SHOP = "shop-a";

const session = (over: Partial<CashSession> = {}): CashSession => ({
  id: "sess-1",
  status: "open",
  opening_float: 3000,
  cash_sales: 0,
  expected_cash: 3000,
  counted_cash: null,
  variance: null,
  sales_count: 0,
  sales_total: 0,
  opened_at: "2026-08-18T09:00:00+05:00",
  closed_at: null,
  register_id: "lane-1",
  ...over,
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
});

describe("a reload must not lose the shift", () => {
  it("gives the shift back after the server is gone", async () => {
    await mirrorShift(session(), SHOP);

    expect(await mirroredShift(SHOP)).toMatchObject({ id: "sess-1", opening_float: 3000 });
  });

  it("keeps the row whole, so nothing has to be reconstructed", async () => {
    // Storing a reduced copy would mean deciding today which fields a till will
    // ever need, and being wrong about it after a reload rather than before.
    await mirrorShift(session({ is_training: true, register_id: "lane-3" }), SHOP);

    const back = await mirroredShift(SHOP);
    expect(back?.is_training).toBe(true);
    expect(back?.register_id).toBe("lane-3");
  });
});

describe("what it must refuse to remember", () => {
  it("forgets the shift when the server says none is open", async () => {
    await mirrorShift(session(), SHOP);
    await mirrorShift(null, SHOP);

    // A remembered shift the shop has since closed is worse than no shift: the
    // till would go on ringing sales into a drawer that has been counted.
    expect(await mirroredShift(SHOP)).toBeNull();
  });

  it("forgets it when the shift comes back closed", async () => {
    await mirrorShift(session(), SHOP);
    await mirrorShift(session({ status: "closed" }), SHOP);

    expect(await mirroredShift(SHOP)).toBeNull();
  });

  it("replaces the old shift rather than accumulating drawers", async () => {
    await mirrorShift(session({ id: "sess-1" }), SHOP);
    await mirrorShift(session({ id: "sess-2" }), SHOP);

    const rows = await getAll<MirroredShift>(STORE.SHIFT);
    expect(rows.map((r) => r.id)).toEqual(["sess-2"]);
  });
});

describe("one browser, two shops", () => {
  it("never hands one shop's drawer to another", async () => {
    // IndexedDB is scoped to the origin, so a laptop used for two tenants has
    // one database. Without the fence, signing into shop B would offer it shop
    // A's open shift and every sale would name a session B does not own.
    await mirrorShift(session(), "shop-a");

    expect(await mirroredShift("shop-b")).toBeNull();
    expect(await mirroredShift("shop-a")).not.toBeNull();
  });

  it("leaves the other shop's row alone rather than deleting it", async () => {
    await mirrorShift(session({ id: "a-1" }), "shop-a");
    await mirrorShift(session({ id: "b-1" }), "shop-b");

    // Shop A signing back in must still find its own drawer.
    expect(await mirroredShift("shop-a")).toMatchObject({ id: "a-1" });
    expect(await mirroredShift("shop-b")).toMatchObject({ id: "b-1" });
  });
});
