import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { useAuthStore } from "../../../stores/authStore";
import { resetDbCache } from "../db/open";
import { getSingleton, putSingleton } from "../db/repo";
import { STORE } from "../db/schema";
import { enqueue, newRow } from "../outbox/outbox";
import type { SyncMeta } from "./applyPull";
import { PULL_ON_OPEN_EVERY_MS, pullIsDue } from "./pullIsDue";

/**
 * DOES OPENING A SCREEN NEED A PULL? — asked of the device, not the server.
 *
 * Every load pulled. The four reasons one still must are each a case here,
 * and so is the one that no longer is one: "a screen was opened".
 */

const NOW = 1_800_000_000_000;

const inShop = (shop: string | null) =>
  useAuthStore.setState({ user: shop === null ? null : ({ id: "u1", tenant: { id: shop } } as never) });

const holds = (meta: Partial<SyncMeta>) =>
  putSingleton(STORE.SYNC_META, { cursors: { products: "2026-10-03 09:00:00|p1" }, clockSkewMs: 0, lastPullAt: null, tenantId: "t1", ...meta });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
  inShop("t1");
});

describe("a till that had everything a moment ago", () => {
  it("does not pull because a screen was opened", async () => {
    await holds({ pulledAt: NOW - 60_000 });

    expect(await pullIsDue(NOW)).toBe(false);
  });

  it("does not pull one second short of five minutes", async () => {
    await holds({ pulledAt: NOW - (PULL_ON_OPEN_EVERY_MS - 1_000) });

    expect(await pullIsDue(NOW)).toBe(false);
  });

  it("pulls at five minutes", async () => {
    await holds({ pulledAt: NOW - PULL_ON_OPEN_EVERY_MS });

    expect(await pullIsDue(NOW)).toBe(true);
  });
});

describe("the reasons a pull cannot wait", () => {
  it("something is waiting to be sent — money out is never put off", async () => {
    await holds({ pulledAt: NOW - 1_000 });
    await enqueue(newRow("op-1", new Date(NOW).toISOString(), "OFF-K7QX-0001", { items: [] }, null, { tenantId: "t1" }));

    expect(await pullIsDue(NOW)).toBe(true);
  });

  it("the till has never had the catalogue", async () => {
    expect(await pullIsDue(NOW)).toBe(true);
  });

  it("the till holds cursors for nothing — a database that was cleared", async () => {
    await holds({ cursors: {}, pulledAt: NOW - 1_000 });

    expect(await pullIsDue(NOW)).toBe(true);
  });

  it("the last pull stopped part-way", async () => {
    await holds({ pulledAt: null });

    expect(await pullIsDue(NOW)).toBe(true);
  });

  it("the catalogue was written before its age was kept — an older install", async () => {
    await holds({});

    expect(await pullIsDue(NOW)).toBe(true);
  });

  it("the device's clock was put back — \"pulled in the future\" is not believed", async () => {
    await holds({ pulledAt: NOW + 3_600_000 });

    expect(await pullIsDue(NOW)).toBe(true);
  });
});

describe("a till handed to another shop", () => {
  it("pulls, however recently the LAST shop's catalogue was complete", async () => {
    await holds({ tenantId: "t1", pulledAt: NOW - 1_000 });
    inShop("t2");

    expect(await pullIsDue(NOW), "the last shop's fresh catalogue stood in for this shop's").toBe(true);
  });

  it("and what it held is gone before anything is decided from it", async () => {
    await holds({ tenantId: "t1", pulledAt: NOW - 1_000 });
    inShop("t2");

    await pullIsDue(NOW);

    const meta = await getSingleton<SyncMeta>(STORE.SYNC_META);
    expect(meta?.tenantId).toBe("t2");
    expect(meta?.cursors).toEqual({});
    expect(meta?.pulledAt ?? null).toBeNull();
  });
});

describe("when the device cannot say", () => {
  it("pulls — a till that cannot read its own database cannot know it owes nothing", async () => {
    // @ts-expect-error removing it on purpose: Safari private mode, a locked-down profile
    delete globalThis.indexedDB;
    resetDbCache();

    expect(await pullIsDue(NOW)).toBe(true);
  });
});
