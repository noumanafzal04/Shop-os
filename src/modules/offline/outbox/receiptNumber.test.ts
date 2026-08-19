import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { putSingleton } from "../db/repo";
import { STORE } from "../db/schema";
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


/**
 * ── WHEN THE TILL FORGETS AND THE SHOP DOES NOT ──────────────────────────
 *
 * The counter lives in IndexedDB. The device id it is printed beside lives in
 * localStorage. Browsers evict those separately — this app carries a whole
 * StorageWarning about it — so a till can lose the counter and keep the id. It
 * then restarts at 000001 under the same device segment, and every slip it
 * mints from then on is one the shop already has.
 *
 * Every one of those used to be refused by the server's unique index and
 * retried for ever behind "This sale could not be recorded. It is still safe on
 * the till." It was safe, and it could not leave.
 */
describe("a counter that was wiped", () => {
  it("starts above what the shop has already recorded", async () => {
    // What the catalog pull brought back: this device's slips reached 47.
    await putSingleton(STORE.SETTINGS, { offline_sequence: 47 });

    expect(
      await nextSequence(),
      "a wiped till went back to 1 and started re-minting numbers the shop has",
    ).toBe(48);
    expect(await nextSequence()).toBe(49);
  });

  it("does not go backwards when the shop knows less than the till", async () => {
    // The ordinary case the moment a till is ahead of its last sync: the
    // server's answer is old, and an old answer must never rewind a counter.
    // Starting from the shop's 2, four numbers run 3, 4, 5, 6.
    await putSingleton(STORE.SETTINGS, { offline_sequence: 2 });
    await nextSequence();
    await nextSequence();
    await nextSequence();

    expect(await nextSequence(), "the server's stale figure pulled the counter back").toBe(6);
  });

  it("is unaffected by a server too old to answer", async () => {
    await putSingleton(STORE.SETTINGS, {});

    expect(await nextSequence()).toBe(1);
    expect(await nextSequence()).toBe(2);
  });
});


/**
 * ── WHICH TILL, ALLOCATED RATHER THAN GUESSED ────────────────────────────
 *
 * The device segment used to be the first four characters of the random id the
 * browser minted for itself, with nothing checking whether another till in the
 * shop already had them. Four characters is 65,536 values: a shop running fifty
 * tills had roughly a one-in-fifty chance that two shared a segment, and from
 * their first sale each they printed identical slip numbers for different
 * customers — and the second one could never be sent.
 */
describe("the device segment", () => {
  it("is the code the server allocated, not a slice of the browser's id", async () => {
    await putSingleton(STORE.DEVICE, { code: "K7QM" });

    const number = await nextOfflineNumber("Lane 1", "abcdef00-1111-2222-3333-444444444444");

    expect(number, "the slip still carries a guessed segment").toContain("-K7QM-");
    expect(number).not.toContain("-ABCD-");
    expect(isOfflineNumber(number), "the allocated code broke the slip's shape").toBe(true);
  });

  it("falls back to the browser's id for a till that has never reached the server", async () => {
    // A tablet unboxed during an outage. Its numbers are no worse than they
    // used to be, and it takes an allocated code the first time it gets a line.
    const number = await nextOfflineNumber("Lane 1", "abcdef00-1111-2222-3333-444444444444");

    expect(number).toContain("-ABCD-");
    expect(isOfflineNumber(number)).toBe(true);
  });
});
