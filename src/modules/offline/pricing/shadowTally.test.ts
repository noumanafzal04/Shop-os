import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { resetDbCache } from "../db/open";
import { bumpTally, emptyTally, MAX_REASONS, readTally } from "./shadowTally";

/**
 * The denominator under the variance count.
 *
 * Zero findings is the answer we are hoping for and also the answer a shop gets
 * when no till ever checked anything — and the second is the quieter of the
 * two. Everything here exists so those cannot be confused.
 */

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
  vi.restoreAllMocks();
});

describe("counting what happened", () => {
  it("starts from nothing rather than from an assumption", async () => {
    expect(await readTally()).toBeUndefined();
  });

  it("counts a match as a check", async () => {
    await bumpTally("matched");

    const tally = await readTally();
    expect(tally?.checked).toBe(1);
    expect(tally?.matched).toBe(1);
  });

  it("counts a SKIP as a check too — a skip is not agreement", async () => {
    // The load-bearing one. A fortnight where every cart was skipped must not
    // read as a fortnight where every cart agreed.
    await bumpTally("skipped", "an item is not in the local catalog yet");

    const tally = await readTally();
    expect(tally?.checked).toBe(1);
    expect(tally?.skipped).toBe(1);
    expect(tally?.matched).toBe(0);
  });

  it("keeps a running total across many sales", async () => {
    await bumpTally("matched");
    await bumpTally("matched");
    await bumpTally("differed");
    await bumpTally("skipped", "no lines");

    const tally = await readTally();
    expect(tally).toMatchObject({ checked: 4, matched: 2, differed: 1, skipped: 1 });
  });

  it("stamps when this till started counting, so a reset is legible", async () => {
    await bumpTally("matched");

    expect(Date.parse(String((await readTally())?.since))).not.toBeNaN();
  });

  it("does not move `since` on every sale", async () => {
    // It marks the START of the window. Rewriting it each time would make a
    // fortnight of evidence look like it was gathered this second.
    await bumpTally("matched");
    const first = (await readTally())?.since;

    await bumpTally("matched");

    expect((await readTally())?.since).toBe(first);
  });
});

describe("why checks were skipped", () => {
  it("keeps the reason, because a projection gap is itself a finding", async () => {
    // Nine carts in ten skipped for "not in the local catalog" says the
    // PROJECTION is incomplete — which would otherwise look like a clean sheet.
    await bumpTally("skipped", "an item is not in the local catalog yet");
    await bumpTally("skipped", "an item is not in the local catalog yet");
    await bumpTally("skipped", "no lines");

    const skips = (await readTally())?.skips;
    expect(skips?.["an item is not in the local catalog yet"]).toBe(2);
    expect(skips?.["no lines"]).toBe(1);
  });

  it("bounds how many distinct reasons it will hold", async () => {
    // The catch-all path reports an error message verbatim, so on a failing
    // database this map is unbounded — growing in the storage that exists to
    // hold unsent sales.
    for (let i = 0; i < MAX_REASONS + 10; i += 1) await bumpTally("skipped", `reason ${i}`);

    const skips = (await readTally())?.skips ?? {};
    expect(Object.keys(skips).length).toBeLessThanOrEqual(MAX_REASONS + 1);
    expect(skips.other).toBe(10);
  });

  it("still counts a reason it already knows once the map is full", async () => {
    // Otherwise the first twelve reasons a till ever saw would lock out the one
    // that starts happening today — which is the one worth reading.
    for (let i = 0; i < MAX_REASONS; i += 1) await bumpTally("skipped", `reason ${i}`);

    await bumpTally("skipped", "reason 0");

    expect((await readTally())?.skips["reason 0"]).toBe(2);
  });

  it("keeps counting the checks even when the reasons are full", async () => {
    for (let i = 0; i < MAX_REASONS + 5; i += 1) await bumpTally("skipped", `reason ${i}`);

    expect((await readTally())?.checked).toBe(MAX_REASONS + 5);
  });
});

describe("when the local database is not there", () => {
  it("never throws — the sale is already done", async () => {
    const real = globalThis.indexedDB;
    // @ts-expect-error removing it on purpose
    delete globalThis.indexedDB;
    resetDbCache();

    await expect(bumpTally("matched")).resolves.toBeUndefined();

    globalThis.indexedDB = real;
    resetDbCache();
  });
});

describe("the empty tally", () => {
  it("is a factory, not a shared constant", async () => {
    // A shared object would be mutated by the first till to count anything and
    // then hand its totals to the next caller — the bug already found once in
    // this module's sibling, applyPull.
    const a = emptyTally("2026-08-14T00:00:00.000Z");
    a.checked = 99;

    expect(emptyTally("2026-08-14T00:00:00.000Z").checked).toBe(0);
  });
});
