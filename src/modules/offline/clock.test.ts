import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { resetDbCache } from "./db/open";
import { putSingleton } from "./db/repo";
import { STORE } from "./db/schema";
import { corrected, driftMs, shopNow } from "./clock";

/**
 * The shop's clock, on a till that cannot ask for it.
 *
 * `sold_at` decides the trading day, the shift, whose figures a sale lands in,
 * and whether the day it belongs to was already counted and banked. Offline it
 * comes from a tablet, and a tablet that has been flat for a week comes back
 * believing it is the day it shipped. Everything here is about not filing a
 * day's takings into a day that has been signed off.
 */

const meta = (over: Record<string, unknown> = {}) =>
  putSingleton(STORE.SYNC_META, { cursors: {}, clockSkewMs: 0, lastPullAt: null, ...over });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
  vi.restoreAllMocks();
});

/**
 * Pin the tablet's clock — by stubbing `Date.now`, NOT with fake timers.
 *
 * IndexedDB's own callbacks run on the real event loop, and every function
 * under test reads the database. Freezing the loop to freeze the clock hangs
 * the read it is meant to be measuring.
 */
const tabletSays = (iso: string): void => {
  vi.spyOn(Date, "now").mockReturnValue(new Date(iso).getTime());
};

describe("the measured drift", () => {
  it("reads what the last catalog pull measured", async () => {
    await meta({ clockSkewMs: 3 * 86_400_000 });

    expect(await driftMs()).toBe(3 * 86_400_000);
  });

  it("reads zero on a till that has never pulled", async () => {
    // Nothing has been measured, so there is nothing to correct by. The server
    // catches this case on arrival instead — it will not file a sale in the
    // future or before the till's own last contact.
    expect(await driftMs()).toBe(0);
  });

  it("reads zero rather than NaN when the stored measurement is rubbish", async () => {
    // A half-written record, a hand-edited database, a build that stored a
    // string. `new Date(NaN)` produces a timestamp that fails validation on the
    // server, and the sale would come back as failed rather than merely late.
    await meta({ clockSkewMs: Number.NaN });

    expect(await driftMs()).toBe(0);
  });
});

describe("what time it is in the shop", () => {
  it("moves a slow tablet FORWARD onto the server's clock", async () => {
    await meta({ clockSkewMs: 3 * 86_400_000 });
    tabletSays("2026-08-12T09:00:00.000Z");

    expect((await shopNow()).toISOString()).toBe("2026-08-15T09:00:00.000Z");
  });

  it("moves a fast tablet BACK", async () => {
    // The direction that files sales into a day nobody has traded yet.
    await meta({ clockSkewMs: -2 * 86_400_000 });
    tabletSays("2026-08-15T09:00:00.000Z");

    expect((await shopNow()).toISOString()).toBe("2026-08-13T09:00:00.000Z");
  });

  it("leaves a correct tablet exactly where it is", async () => {
    await meta({ clockSkewMs: 0 });
    tabletSays("2026-08-15T09:00:00.000Z");

    expect((await shopNow()).toISOString()).toBe("2026-08-15T09:00:00.000Z");
  });
});

describe("moments this till stamped earlier", () => {
  it("applies the SAME offset, so a sale and its floor describe one day", async () => {
    // `lastServerContact` was written from the same wrong clock. It is the
    // floor the server measures the sale against — correcting one and not the
    // other hands the server two numbers that no longer agree, and the floor
    // then rewrites a sale that was filed correctly.
    await meta({ clockSkewMs: 3 * 86_400_000 });

    const stamped = new Date("2026-08-12T06:00:00.000Z").getTime();

    expect((await corrected(stamped)).toISOString()).toBe("2026-08-15T06:00:00.000Z");
  });
});
