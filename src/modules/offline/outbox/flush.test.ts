import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { resetDbCache } from "../db/open";
import { flushOutbox, outboxApi } from "./flush";
import { enqueue, newRow, OUTBOX_STATUS, readRow, type OutboxRow } from "./outbox";

/**
 * Sending the sales this till is holding.
 *
 * Two failures are possible and only one of them is survivable. Sending a sale
 * twice costs a lookup on the server, which keys on `op` and hands back the
 * original. NOT sending it costs the sale — a customer paid, walked out, and
 * the shop has no record.
 *
 * So every doubtful case below resolves the same way: send it again.
 */

/** The shop signed in for every test here. */
const SHOP = "shop-a";

const row = (op: string, over: Partial<OutboxRow> = {}): OutboxRow => ({
  ...newRow(op, "2026-08-16T10:00:00.000Z", `OFF-L1-AB-${op}`, { total: 100 }, null, {
    tenantId: SHOP,
  }),
  ...over,
});

const envelope = <T,>(data: T) => ({ success: true, message: "", data, errors: {}, meta: {} });

const answer = (op: string, over: Record<string, unknown> = {}) => ({
  op,
  status: "applied",
  invoice_number: `INV-${op}`,
  violations: [],
  ...over,
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
  vi.restoreAllMocks();
  // jsdom has no Web Locks. The flush must still run without it: being
  // single-tab saves bandwidth, it is not what makes this correct.
  // @ts-expect-error deliberately absent
  delete globalThis.navigator.locks;
});

describe("sending", () => {
  it("sends what is owed and retires it", async () => {
    await enqueue(row("1"));
    const sync = vi
      .spyOn(outboxApi, "sync")
      .mockResolvedValue(envelope({ results: [answer("1")], accepted: 1 }) as never);

    const result = await flushOutbox(SHOP);

    expect(sync).toHaveBeenCalledTimes(1);
    expect(result.acked).toBe(1);
    expect((await readRow("1"))?.status).toBe(OUTBOX_STATUS.ACKED);
    expect((await readRow("1"))?.invoiceNumber).toBe("INV-1");
  });

  it("does nothing when there is nothing owed", async () => {
    const sync = vi.spyOn(outboxApi, "sync");

    expect((await flushOutbox(SHOP)).sent).toBe(0);
    expect(sync).not.toHaveBeenCalled();
  });

  it("sends the sale in the shape the server takes", async () => {
    await enqueue(row("1"));
    const sync = vi
      .spyOn(outboxApi, "sync")
      .mockResolvedValue(envelope({ results: [answer("1")], accepted: 1 }) as never);

    await flushOutbox(SHOP);

    expect(sync.mock.calls[0][0][0]).toMatchObject({
      op: "1",
      at: "2026-08-16T10:00:00.000Z",
      offline_number: "OFF-L1-AB-1",
      sale: { total: 100 },
    });
  });

  it("treats DUPLICATE as success, not as an error", async () => {
    // The server already has it, which is exactly what this row was owed.
    // Calling that a failure would leave a sale queued for ever against a
    // server that has already banked it.
    await enqueue(row("1"));
    vi.spyOn(outboxApi, "sync").mockResolvedValue(
      envelope({ results: [answer("1", { status: "duplicate" })], accepted: 1 }) as never,
    );

    await flushOutbox(SHOP);

    expect((await readRow("1"))?.status).toBe(OUTBOX_STATUS.ACKED);
  });
});

describe("what goes on the wire", () => {
  const sent = async (stored: OutboxRow): Promise<Record<string, unknown>> => {
    await enqueue(stored);
    const sync = vi
      .spyOn(outboxApi, "sync")
      .mockResolvedValue(envelope({ results: [answer(stored.op)], accepted: 1 }) as never);

    await flushOutbox(SHOP);

    return (sync.mock.calls[0][0] as Record<string, unknown>[])[0];
  };

  it("tells the server whether this till was on a practice drawer", async () => {
    // The server needs this AND the shift to agree before a synced sale counts
    // as practice — a shift id alone, named by a client hours later, would be
    // enough to make a real sale take no stock and earn no revenue.
    expect(await sent(row("1", { training: true }))).toMatchObject({ training: true });
  });

  it("says 'real' for an ordinary sale", async () => {
    expect(await sent(row("1"))).toMatchObject({ training: false });
  });

  it("says 'real' for a row written before the field existed", async () => {
    // Silence must not be read as practice. A practice sale recorded as real
    // is visible and can be voided; a real sale recorded as practice is
    // invisible, which is the whole point of sending this at all.
    const older = row("1") as Partial<OutboxRow>;
    delete older.training;

    expect(await sent(older as OutboxRow)).toMatchObject({ training: false });
  });
});

describe("one browser, two shops", () => {
  // The outbox lives in IndexedDB, which is scoped to the browser ORIGIN and
  // not to the shop that is signed in. A laptop used for two tenants — an owner
  // with two shops, a support machine, a demo — has ONE queue. Flushing it
  // under whoever happens to be logged in would file one business's takings
  // into another's books, from the till's own catalog prices, silently.
  //
  // Everywhere else in this file the tie breaks towards SENDING, because not
  // sending costs the sale. Here there is a third outcome and it is worse than
  // both, so it breaks the other way: a stuck row can be read, counted and
  // recovered; a row filed under the wrong business cannot.

  it("does not send another shop's sales", async () => {
    await enqueue(row("1", { tenantId: "shop-b" }));
    const sync = vi.spyOn(outboxApi, "sync");

    const result = await flushOutbox(SHOP);

    expect(sync).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
    // Held, not lost. It is still owed to the shop it belongs to.
    expect((await readRow("1"))?.status).toBe(OUTBOX_STATUS.PENDING);
  });

  it("sends this shop's while holding the other's", async () => {
    await enqueue(row("mine"));
    await enqueue(row("theirs", { tenantId: "shop-b" }));
    const sync = vi
      .spyOn(outboxApi, "sync")
      .mockResolvedValue(envelope({ results: [answer("mine")], accepted: 1 }) as never);

    await flushOutbox(SHOP);

    expect(sync.mock.calls[0][0]).toHaveLength(1);
    expect((await readRow("mine"))?.status).toBe(OUTBOX_STATUS.ACKED);
    expect((await readRow("theirs"))?.status).toBe(OUTBOX_STATUS.PENDING);
  });

  it.each([
    ["a row written before the field existed", "missing" as const],
    ["a row whose shop is explicitly unset", "null" as const],
  ])("holds %s", async (_label, how) => {
    // We cannot tell whose it is, and guessing puts real money in the wrong
    // business. BOTH shapes are tested because they are different values:
    // deleting the key gives `undefined`, while `newRow` with no shop gives
    // `null` — and a guard written against only one of them lets the other
    // through. A mutation that sent explicit nulls stayed green until this
    // second case existed.
    const legacy = row("1") as Partial<OutboxRow>;
    if (how === "missing") delete legacy.tenantId;
    else legacy.tenantId = null;

    await enqueue(legacy as OutboxRow);
    const sync = vi.spyOn(outboxApi, "sync");

    await flushOutbox(SHOP);

    expect(sync).not.toHaveBeenCalled();
  });

  it("sends nothing at all when no shop is signed in", async () => {
    // No session means no way to know whose these are.
    await enqueue(row("1"));
    const sync = vi.spyOn(outboxApi, "sync");

    await flushOutbox(null);

    expect(sync).not.toHaveBeenCalled();
  });
});

describe("when the link dies", () => {
  it("puts every row back, and loses nothing", async () => {
    await enqueue(row("1"));
    await enqueue(row("2"));
    vi.spyOn(outboxApi, "sync").mockRejectedValue(new Error("Network Error"));

    await flushOutbox(SHOP);

    for (const op of ["1", "2"]) {
      const stored = await readRow(op);
      expect(stored?.status).toBe(OUTBOX_STATUS.PENDING);
      expect(stored?.sale).toEqual({ total: 100 });
    }
  });

  it("does not mark them FAILED — the answer may change", async () => {
    // FAILED is for a refusal that retrying cannot help. A dropped connection
    // is the opposite of that.
    await enqueue(row("1"));
    vi.spyOn(outboxApi, "sync").mockRejectedValue(new Error("Network Error"));

    await flushOutbox(SHOP);

    expect((await readRow("1"))?.status).not.toBe(OUTBOX_STATUS.FAILED);
  });

  it("backs off, so a dead link is not hammered", async () => {
    await enqueue(row("1"));
    vi.spyOn(outboxApi, "sync").mockRejectedValue(new Error("Network Error"));

    await flushOutbox(SHOP);

    expect((await readRow("1"))?.nextAttemptAt).not.toBeNull();
  });
});

describe("when the server answers per row", () => {
  it("retires the ones that landed and keeps the ones that did not", async () => {
    // One unrecognised row must not cost forty-nine acknowledgements.
    await enqueue(row("1"));
    await enqueue(row("2"));
    vi.spyOn(outboxApi, "sync").mockResolvedValue(
      envelope({
        results: [
          answer("1"),
          answer("2", { status: "failed", retryable: false, message: "Discount exceeds subtotal" }),
        ],
        accepted: 1,
      }) as never,
    );

    await flushOutbox(SHOP);

    expect((await readRow("1"))?.status).toBe(OUTBOX_STATUS.ACKED);
    expect((await readRow("2"))?.status).toBe(OUTBOX_STATUS.FAILED);
    expect((await readRow("2"))?.error).toMatch(/Discount/);
  });

  it("retries a failure the server said was worth retrying", async () => {
    await enqueue(row("1"));
    vi.spyOn(outboxApi, "sync").mockResolvedValue(
      envelope({
        results: [answer("1", { status: "failed", retryable: true, message: "temporary" })],
        accepted: 0,
      }) as never,
    );

    await flushOutbox(SHOP);

    expect((await readRow("1"))?.status).toBe(OUTBOX_STATUS.PENDING);
  });

  it("SENDS AGAIN a row the server said nothing about", async () => {
    // It may or may not have landed, and only one of those assumptions can
    // lose money. The server's `op` key absorbs the duplicate.
    await enqueue(row("1"));
    await enqueue(row("2"));
    vi.spyOn(outboxApi, "sync").mockResolvedValue(
      envelope({ results: [answer("1")], accepted: 1 }) as never,
    );

    await flushOutbox(SHOP);

    expect((await readRow("2"))?.status).toBe(OUTBOX_STATUS.PENDING);
    expect((await readRow("2"))?.sale).toEqual({ total: 100 });
  });

  it("carries back what the shop flagged", async () => {
    await enqueue(row("1"));
    vi.spyOn(outboxApi, "sync").mockResolvedValue(
      envelope({
        results: [answer("1", { violations: ["Khata needs the connection"] })],
        accepted: 1,
      }) as never,
    );

    await flushOutbox(SHOP);

    expect((await readRow("1"))?.violations).toEqual(["Khata needs the connection"]);
  });
});

describe("more than one tab", () => {
  it("only one flusher runs when the browser can arbitrate", async () => {
    await enqueue(row("1"));
    const sync = vi
      .spyOn(outboxApi, "sync")
      .mockResolvedValue(envelope({ results: [answer("1")], accepted: 1 }) as never);

    let held = false;
    // @ts-expect-error a minimal stand-in for the real Web Locks API
    globalThis.navigator.locks = {
      request: async (
        _name: string,
        _options: unknown,
        fn: (lock: unknown) => Promise<void>,
      ): Promise<void> => {
        if (held) return fn(null); // another tab has it
        held = true;
        await fn({});
        held = false;
      },
    };

    const [first, second] = await Promise.all([flushOutbox(SHOP), flushOutbox(SHOP)]);

    expect(sync).toHaveBeenCalledTimes(1);
    expect([first.skipped, second.skipped]).toContain(true);
  });

  it("still flushes on a browser with no Web Locks at all", async () => {
    // Correctness is the server's `op` key. Being single-tab is a saving, and
    // a till on an old browser must not simply stop sending.
    await enqueue(row("1"));
    vi.spyOn(outboxApi, "sync").mockResolvedValue(
      envelope({ results: [answer("1")], accepted: 1 }) as never,
    );

    expect((await flushOutbox(SHOP)).acked).toBe(1);
  });
});

describe("the loop", () => {
  it("keeps going while there is more to send", async () => {
    for (let i = 0; i < 60; i += 1) await enqueue(row(String(i).padStart(3, "0")));
    const sync = vi.spyOn(outboxApi, "sync").mockImplementation((async (ops: unknown[]) =>
      envelope({
        results: (ops as Array<{ op: string }>).map((o) => answer(o.op)),
        accepted: ops.length,
      })) as never);

    const result = await flushOutbox(SHOP);

    expect(sync).toHaveBeenCalledTimes(2);
    expect(result.acked).toBe(60);
  });

  it("stops rather than spinning when a round makes no progress", async () => {
    // Every row back to PENDING means the queue did not move. Looping would
    // spin against the same rows for ever.
    await enqueue(row("1", { nextAttemptAt: null }));
    const sync = vi.spyOn(outboxApi, "sync").mockResolvedValue(
      envelope({ results: [], accepted: 0 }) as never,
    );

    await flushOutbox(SHOP);

    expect(sync).toHaveBeenCalledTimes(1);
  });
});

describe("telling the till how far it has got", () => {
  /**
   * The one moment a shopkeeper is watching hardest: the line has come back and
   * a day's takings are going up. Without this the pill went straight from
   * "47 saved here" to "Online" with a silent gap in between, and a gap is
   * where somebody starts pressing things.
   */

  it("reports how many are done out of how many were owed", async () => {
    for (const op of ["1", "2", "3"]) await enqueue(row(op));
    vi.spyOn(outboxApi, "sync").mockResolvedValue(
      envelope({ results: [answer("1"), answer("2"), answer("3")], accepted: 3 }) as never,
    );

    const seen: Array<[number, number]> = [];
    await flushOutbox(SHOP, (done, total) => seen.push([done, total]));

    expect(seen).toEqual([[3, 3]]);
  });

  it("counts rows that got an ANSWER, not rows that went on the wire", async () => {
    // A round where everything came back to PENDING made no progress. Counting
    // the wire would show a bar marching to the end while nothing was banked —
    // the reading a shop would act on, and the one that would be wrong.
    for (const op of ["1", "2"]) await enqueue(row(op));
    vi.spyOn(outboxApi, "sync").mockResolvedValue(
      envelope({
        results: [answer("1"), answer("2", { status: "failed", retryable: true })],
        accepted: 1,
      }) as never,
    );

    const seen: Array<[number, number]> = [];
    await flushOutbox(SHOP, (done, total) => seen.push([done, total]));

    // Asserted on the VALUES rather than the number of calls: a retryable row
    // is offered again within the same flush, so this reports more than once —
    // and every one of those reports must still say one of two. Pinning the
    // call count instead would have made this a test of the retry schedule.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(([done, total]) => done === 1 && total === 2)).toBe(true);
  });

  it("holds the total still when a sale is rung mid-flush", async () => {
    // The denominator is what was owed when this started. Letting a new sale
    // extend it makes the bar walk backwards while the cashier watches it.
    await enqueue(row("1"));
    await enqueue(row("2"));

    let round = 0;
    vi.spyOn(outboxApi, "sync").mockImplementation((async (batch: unknown) => {
      const ops = (batch as Array<{ op: string }>).map((b) => b.op);
      // A third sale arrives while the first round is in the air.
      if (round === 0) await enqueue(row("3"));
      round += 1;

      return envelope({ results: ops.map((op) => answer(op)), accepted: ops.length });
    }) as never);

    const totals: number[] = [];
    await flushOutbox(SHOP, (_done, total) => totals.push(total));

    expect(new Set(totals)).toEqual(new Set([2]));
  });

  it("says nothing at all when the queue is empty", async () => {
    // "Sending 0 of 0" every fifteen minutes teaches a cashier to stop reading
    // the pill.
    const onProgress = vi.fn();

    await flushOutbox(SHOP, onProgress);

    expect(onProgress).not.toHaveBeenCalled();
  });

  it("still sends when nobody is listening", async () => {
    // The callback is an extra, never a requirement. Every existing caller
    // passes nothing.
    await enqueue(row("1"));
    vi.spyOn(outboxApi, "sync").mockResolvedValue(
      envelope({ results: [answer("1")], accepted: 1 }) as never,
    );

    expect((await flushOutbox(SHOP)).acked).toBe(1);
  });
});
