import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { resetDbCache } from "../db/open";
import { isOfflineNumber, nextOfflineNumber, nextSequence } from "./receiptNumber";

/**
 * The number printed on a receipt rung with no server.
 *
 * A till never mints a real invoice number. The server's sequence is one
 * counter for the whole shop, and two tablets offline would both take
 * "INV-1043" — leaving the shop with two different sales wearing the same
 * number, in the books and on two customers' receipts. There is no repair for
 * that which does not involve reprinting somebody's paperwork.
 */

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
});

describe("the number", () => {
  it("is visibly not an invoice number", async () => {
    // Whoever picks up the slip has to be able to tell. A number that looked
    // like an invoice number would be typed into a search that finds nothing.
    expect(await nextOfflineNumber("Lane 1", "ab12cd34-0000-0000-0000-000000000000"))
      .toMatch(/^OFF-/);
  });

  it("carries the lane and the device, so two tills cannot collide", async () => {
    const one = await nextOfflineNumber("Lane 1", "aaaaaaaa-0000-0000-0000-000000000000");
    resetDbCache();
    globalThis.indexedDB = new IDBFactory();
    const two = await nextOfflineNumber("Lane 2", "bbbbbbbb-0000-0000-0000-000000000000");

    // Same sequence on both — only the segments keep them apart.
    expect(one).toBe("OFF-LANE1-AAAA-000001");
    expect(two).toBe("OFF-LANE2-BBBB-000001");
    expect(one).not.toBe(two);
  });

  it("counts up on the same till", async () => {
    const device = "ab12cd34-0000-0000-0000-000000000000";

    expect(await nextOfflineNumber("Lane 1", device)).toMatch(/000001$/);
    expect(await nextOfflineNumber("Lane 1", device)).toMatch(/000002$/);
    expect(await nextOfflineNumber("Lane 1", device)).toMatch(/000003$/);
  });

  it("PERSISTS the counter before handing the number out", async () => {
    // A number handed out and then lost to a crash is a number the next sale
    // takes again — two receipts, one identity, on one till. Writing first
    // costs a skipped number when it goes wrong, which costs nothing.
    await nextSequence();

    resetDbCache(); // as though the tab had died and reopened

    expect(await nextSequence()).toBe(2);
  });

  it("works for a shop with no lanes at all", async () => {
    // One counter, no registers configured — the commonest small shop.
    expect(await nextOfflineNumber(null, "ab12cd34-0000-0000-0000-000000000000"))
      .toBe("OFF-TILL-AB12-000001");
  });

  it("survives a lane named in Urdu, keeping whatever is printable", async () => {
    // A slip is 32 characters of ASCII on thermal paper. "کاؤنٹر #1" reduces
    // to "1", which is not a loss — it is the lane number, and the device
    // segment is what actually guarantees uniqueness.
    const number = await nextOfflineNumber("کاؤنٹر #1", "ab12cd34-0000-0000-0000-000000000000");

    expect(number).toBe("OFF-1-AB12-000001");
    expect(number).toMatch(/^[A-Z0-9-]+$/);
    expect(isOfflineNumber(number)).toBe(true);
  });

  it("falls back when a lane name has nothing printable at all", async () => {
    expect(await nextOfflineNumber("کاؤنٹر", "ab12cd34-0000-0000-0000-000000000000"))
      .toBe("OFF-TILL-AB12-000001");
  });

  it("keeps a long lane name from running off the paper", async () => {
    expect(await nextOfflineNumber("Main Counter Downstairs", "ab12cd34-0000-0000-0000-000000000000"))
      .toBe("OFF-MAINCO-AB12-000001");
  });
});

describe("telling a slip from an invoice", () => {
  it("recognises its own", async () => {
    expect(isOfflineNumber(await nextOfflineNumber("Lane 1", "ab12cd34-0000-0000-0000-0000"))).toBe(true);
  });

  it("does not claim a real invoice number", () => {
    expect(isOfflineNumber("INV-1043")).toBe(false);
    expect(isOfflineNumber("OFF")).toBe(false);
    expect(isOfflineNumber("")).toBe(false);
  });
});
