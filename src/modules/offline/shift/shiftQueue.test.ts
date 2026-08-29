import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { resetDbCache } from "../db/open";
import { getAll } from "../db/repo";
import { STORE } from "../db/schema";
import { mirroredShift } from "./shiftMirror";
import { closeShiftOffline, openShiftOffline, recordMovementOffline } from "./offlineShift";
import {
  adoptStrandedShiftOps,
  dueShiftOps,
  enqueueShiftOp,
  markShiftOpFailed,
  markShiftOpRetry,
  newShiftOp,
  owedShiftOps,
  SHIFT_OP_STATUS,
  strandedShiftOps,
  type ShiftOpRow,
} from "./shiftQueue";

/**
 * The drawer, when there is no server.
 *
 * A shop whose line was already down at opening time could not start a shift,
 * and with no shift the till refuses to tender — so the whole offline module
 * was unreachable on the morning it exists for. And a shift that ran through an
 * outage could not be counted out, which is the shop's own control over its own
 * cash.
 */

const SHOP = "shop-a";

vi.mock("../clock", () => ({
  shopNow: () => Promise.resolve(new Date("2026-08-18T04:00:00.000Z")),
}));

const op = (kind: "open" | "movement" | "close", over: Partial<ShiftOpRow> = {}): ShiftOpRow => ({
  ...newShiftOp(`op-${kind}-${Math.abs(kind.length + (over.createdAt?.length ?? 0))}`, kind,
    "2026-08-18T04:00:00Z", "sess-1", {}, SHOP),
  ...over,
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
});

describe("opens go before the sales, and the count goes after", () => {
  it("hands back only the kinds asked for", async () => {
    await enqueueShiftOp(op("open", { op: "a", createdAt: "2026-08-18T04:00:00Z" }));
    await enqueueShiftOp(op("close", { op: "b", createdAt: "2026-08-18T14:00:00Z" }));

    // The caller asks for opens, sends the sale queue, then asks for the rest.
    // A close that overtook its own sales would compare counted cash against a
    // drawer the server thinks is empty and report a variance the size of the
    // day's takings.
    expect((await dueShiftOps(["open"], Date.now(), SHOP)).map((r) => r.op)).toEqual(["a"]);
    expect((await dueShiftOps(["movement", "close"], Date.now(), SHOP)).map((r) => r.op)).toEqual(["b"]);
  });

  it("keeps two movements on one shift in the order the cashier made them", async () => {
    await enqueueShiftOp(op("movement", { op: "second", createdAt: "2026-08-18T09:00:00Z" }));
    await enqueueShiftOp(op("movement", { op: "first", createdAt: "2026-08-18T08:00:00Z" }));

    expect((await dueShiftOps(["movement"], Date.now(), SHOP)).map((r) => r.op)).toEqual(["first", "second"]);
  });
});

describe("one browser, two shops", () => {
  it("sends nothing when the shop is not known", async () => {
    await enqueueShiftOp(op("open", { op: "a" }));

    // The same tie-break the sale queue makes, for its harder reason: a stuck
    // row can be read, counted and recovered; a drawer filed under the wrong
    // business cannot.
    expect(await dueShiftOps(["open"], Date.now(), null)).toEqual([]);
  });

  it("never sends another shop's drawer", async () => {
    await enqueueShiftOp(op("open", { op: "a", tenantId: "shop-b" }));

    expect(await dueShiftOps(["open"], Date.now(), SHOP)).toEqual([]);
  });
});

describe("what a failure means", () => {
  it("a retry waits and stays owed", async () => {
    const row = op("close", { op: "a", attempts: 1 });
    await enqueueShiftOp(row);
    await markShiftOpRetry(row, "Could not reach the server", 1_000_000);

    const [back] = await getAll<ShiftOpRow>(STORE.SHIFT_QUEUE);
    expect(back.status).toBe(SHIFT_OP_STATUS.PENDING);
    // Waiting, not gone: a counted drawer that never reached the server exists
    // nowhere else in the world.
    expect(Date.parse(back.nextAttemptAt!)).toBeGreaterThan(1_000_000);
    expect(await owedShiftOps()).toBe(1);

    // And it is not due yet.
    expect(await dueShiftOps(["close"], 1_000_000, SHOP)).toEqual([]);
    expect(await dueShiftOps(["close"], 9_000_000, SHOP)).toHaveLength(1);
  });

  it("a refusal stops being owed, because somebody has to be told", async () => {
    const row = op("close", { op: "a" });
    await enqueueShiftOp(row);
    await markShiftOpFailed(row, "The shop refused this");

    expect(await owedShiftOps()).toBe(0);
  });
});

describe("opening and closing with no server", () => {
  it("mints the shift here, so the sales queued behind it have something to name", async () => {
    const session = await openShiftOffline(3000, "lane-1", false, SHOP);

    expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.status).toBe("open");
    expect(session.opening_float).toBe(3000);

    const queued = await dueShiftOps(["open"], Date.now(), SHOP);
    expect(queued).toHaveLength(1);
    expect(queued[0].sessionId).toBe(session.id);
    expect(queued[0].payload).toMatchObject({ opening_float: 3000, register_id: "lane-1" });
  });

  it("is standing at that shift immediately, and still is after a reload", async () => {
    const session = await openShiftOffline(3000, null, false, SHOP);

    // This is the whole point: the till can sell into it, and a restart does
    // not take it away.
    expect((await mirroredShift(SHOP))?.id).toBe(session.id);
  });

  it("stamps the shop's clock, not the arrival time", async () => {
    // A shift stamped from an uncorrected tablet three days slow would file a
    // day's takings into a trading day already counted and banked.
    const session = await openShiftOffline(3000, null, false, SHOP);
    expect(session.opened_at).toBe("2026-08-18T04:00:00.000Z");
  });

  it("carries practice through, because it is fixed at open", async () => {
    const session = await openShiftOffline(3000, null, true, SHOP);

    expect(session.is_training).toBe(true);
    expect((await dueShiftOps(["open"], Date.now(), SHOP))[0].payload).toMatchObject({ is_training: true });
  });

  it("counting the drawer stops this till selling into it, and still owes the close", async () => {
    await openShiftOffline(3000, null, false, SHOP);
    await closeShiftOffline(3200, "Counted at the till", SHOP);

    // Stopped standing at a drawer that is shut …
    expect(await mirroredShift(SHOP)).toBeNull();
    // … but the count itself is still owed to the server.
    const queued = await dueShiftOps(["close"], Date.now(), SHOP);
    expect(queued).toHaveLength(1);
    expect(queued[0].payload).toMatchObject({ counted_cash: 3200 });
  });

  it("refuses to record cash against a drawer that does not exist", async () => {
    // Inventing a shift here would file the money against a till nobody has.
    await expect(recordMovementOffline("paid_out", 500, "Chai", null, SHOP)).rejects.toThrow();
  });

  it("records cash out of the drawer against the shift it was taken from", async () => {
    const session = await openShiftOffline(3000, null, false, SHOP);
    await recordMovementOffline("paid_out", 500, "Chai", null, SHOP);

    const queued = await dueShiftOps(["movement"], Date.now(), SHOP);
    expect(queued[0].sessionId).toBe(session.id);
    expect(queued[0].payload).toMatchObject({ type: "paid_out", amount: 500, reason: "Chai" });
  });
});


/**
 * THE HALF OF A RULE THAT WAS NEVER WRITTEN DOWN.
 *
 * The sale queue learned two things after a shop watched "7 still to send" for
 * days: a press forces the backoff, and a row the fence is holding has to be
 * VISIBLE. Both were implemented in `outbox.ts` and neither was carried across
 * to this file — which the badge adds to the same total, so the symptom is
 * identical and the cause is in the half nobody looked at.
 */
describe("a person pressed Sync", () => {
  it("still waits out the backoff when nobody asked", async () => {
    // The automatic sync must keep its ladder: a till back from two days away
    // must not re-send its whole queue in its first minute.
    const waiting = op("close", {
      op: "waiting",
      nextAttemptAt: new Date(Date.now() + 600_000).toISOString(),
    });
    await enqueueShiftOp(waiting);

    expect(await dueShiftOps(["close"], Date.now(), SHOP)).toEqual([]);
  });

  it("sends a drawer event that is still sitting out its ten minutes", async () => {
    // THE BUG. The sale queue forced; this one did not. A till holding only
    // shift events answered every press by doing nothing whatsoever, while the
    // badge — which counts both queues — went on reading seven.
    const waiting = op("close", {
      op: "waiting",
      nextAttemptAt: new Date(Date.now() + 600_000).toISOString(),
    });
    await enqueueShiftOp(waiting);

    const forced = await dueShiftOps(["close"], Date.now(), SHOP, true);
    expect(forced.map((r) => r.op)).toEqual(["waiting"]);
  });

  it("does not let a forced press jump the fence", async () => {
    // Forcing is about the CLOCK, never about whose shop it is. A press must
    // not post another business's drawer count under this shop's token.
    await enqueueShiftOp(op("close", { op: "theirs", tenantId: "shop-b", nextAttemptAt: null }));

    expect(await dueShiftOps(["close"], Date.now(), SHOP, true)).toEqual([]);
  });
});

describe("drawer events the fence is holding", () => {
  it("names a row that belongs to another shop", async () => {
    await enqueueShiftOp(op("close", { op: "theirs", tenantId: "shop-b" }));

    const stuck = await strandedShiftOps(SHOP);
    expect(stuck.map((r) => r.op)).toEqual(["theirs"]);
  });

  it("names a row that belongs to no shop at all", async () => {
    // The auth store had not hydrated when the drawer was counted. Ours, not
    // the shopkeeper's.
    await enqueueShiftOp(op("close", { op: "orphan", tenantId: null }));

    expect((await strandedShiftOps(SHOP)).map((r) => r.op)).toEqual(["orphan"]);
  });

  it("is counted by the badge and never offered to the flush", async () => {
    // All three numbers agreeing that one is waiting, and — before this — no
    // screen anywhere able to say why it never moves.
    await enqueueShiftOp(op("close", { op: "orphan", tenantId: null }));

    expect(await owedShiftOps()).toBe(1);
    expect(await dueShiftOps(["close"], Date.now(), SHOP)).toEqual([]);
    expect(await dueShiftOps(["close"], Date.now(), SHOP, true)).toEqual([]);
    expect(await strandedShiftOps(SHOP)).toHaveLength(1);
  });

  it("says nothing about a row that is already finished", async () => {
    const done = op("close", { op: "done", tenantId: null, status: SHIFT_OP_STATUS.ACKED });
    await enqueueShiftOp(done);

    expect(await strandedShiftOps(SHOP)).toEqual([]);
  });

  it("adopts the orphan and leaves the other shop's alone", async () => {
    await enqueueShiftOp(op("close", { op: "orphan", tenantId: null }));
    await enqueueShiftOp(op("close", { op: "theirs", tenantId: "shop-b" }));

    expect(await adoptStrandedShiftOps(SHOP)).toBe(1);

    // The adopted one can now go…
    expect((await dueShiftOps(["close"], Date.now(), SHOP)).map((r) => r.op)).toEqual(["orphan"]);
    // …and the one the fence exists for is untouched. No button moves one
    // business's drawer count into another's books.
    expect((await strandedShiftOps(SHOP)).map((r) => r.op)).toEqual(["theirs"]);
  });

  it("adopts nothing when the till does not know its own shop", async () => {
    await enqueueShiftOp(op("close", { op: "orphan", tenantId: null }));

    expect(await adoptStrandedShiftOps(null)).toBe(0);
  });
});
