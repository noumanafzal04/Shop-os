import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import * as client from "../../../common/api/client";
import { resetDbCache } from "../db/open";
import { putSingleton } from "../db/repo";
import { STORE } from "../db/schema";
import { emptyTally } from "../pricing/shadowTally";
import { deviceService } from "./deviceService";

/**
 * A till announcing itself — and what it has been doing.
 *
 * The tally rides THIS call rather than travelling with the variance report,
 * and the direction matters: a till that finds nothing never reports a
 * variance, and that is exactly the till whose count the shop needs. Sending
 * the denominator only alongside findings would mean the shops with a clean
 * sheet were the ones that could never prove it.
 */

const envelope = <T,>(data: T) => ({ success: true, message: "", data, errors: {}, meta: {} });

/** The JSON the till actually posted. */
const body = (post: { mock: { calls: unknown[][] } }): Record<string, unknown> =>
  post.mock.calls[0][1] as Record<string, unknown>;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
  vi.restoreAllMocks();
});

describe("announcing a till", () => {
  it("sends the tally the till has been keeping", async () => {
    const tally = { ...emptyTally("2026-08-01T00:00:00.000Z"), checked: 120, matched: 118, skipped: 2 };
    await putSingleton(STORE.SHADOW_TALLY, tally);
    const post = vi.spyOn(client, "apiPost").mockResolvedValue(envelope({}) as never);

    await deviceService.register("d1");

    expect(body(post).shadow).toEqual({
      checked: 120,
      matched: 118,
      skipped: 2,
      differed: 0,
      since: "2026-08-01T00:00:00.000Z",
    });
  });

  it("sends none at all when the till has checked nothing yet", async () => {
    // Rather than a zeroed one. A shop reading "0 of 0" would be told nothing;
    // an absent tally is the honest "this till has not started".
    const post = vi.spyOn(client, "apiPost").mockResolvedValue(envelope({}) as never);

    await deviceService.register("d1");

    expect(body(post)).not.toHaveProperty("shadow");
  });

  it("still registers when the local database cannot be read", async () => {
    // The tally is diagnostics. A till that could not register — and so could
    // not sell — because it failed to describe itself would be the worse bug.
    const real = globalThis.indexedDB;
    // @ts-expect-error removing it on purpose
    delete globalThis.indexedDB;
    resetDbCache();
    const post = vi.spyOn(client, "apiPost").mockResolvedValue(envelope({}) as never);

    await expect(deviceService.register("d1")).resolves.toBeTruthy();
    expect(body(post).device_id).toBe("d1");

    globalThis.indexedDB = real;
    resetDbCache();
  });

  it("does not blank a name it was not given", async () => {
    const post = vi.spyOn(client, "apiPost").mockResolvedValue(envelope({}) as never);

    await deviceService.register("d1");

    expect(body(post)).not.toHaveProperty("name");
  });

  it("sends a name when there is one", async () => {
    const post = vi.spyOn(client, "apiPost").mockResolvedValue(envelope({}) as never);

    await deviceService.register("d1", "Counter tablet");

    expect(body(post).name).toBe("Counter tablet");
  });
});
