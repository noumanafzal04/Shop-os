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

const row = (op: string, over: Partial<OutboxRow> = {}): OutboxRow => ({
  ...newRow(op, "2026-08-16T10:00:00.000Z", `OFF-L1-AB-${op}`, { total: 100 }, null),
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

    const result = await flushOutbox();

    expect(sync).toHaveBeenCalledTimes(1);
    expect(result.acked).toBe(1);
    expect((await readRow("1"))?.status).toBe(OUTBOX_STATUS.ACKED);
    expect((await readRow("1"))?.invoiceNumber).toBe("INV-1");
  });

  it("does nothing when there is nothing owed", async () => {
    const sync = vi.spyOn(outboxApi, "sync");

    expect((await flushOutbox()).sent).toBe(0);
    expect(sync).not.toHaveBeenCalled();
  });

  it("sends the sale in the shape the server takes", async () => {
    await enqueue(row("1"));
    const sync = vi
      .spyOn(outboxApi, "sync")
      .mockResolvedValue(envelope({ results: [answer("1")], accepted: 1 }) as never);

    await flushOutbox();

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

    await flushOutbox();

    expect((await readRow("1"))?.status).toBe(OUTBOX_STATUS.ACKED);
  });
});

describe("what goes on the wire", () => {
  const sent = async (stored: OutboxRow): Promise<Record<string, unknown>> => {
    await enqueue(stored);
    const sync = vi
      .spyOn(outboxApi, "sync")
      .mockResolvedValue(envelope({ results: [answer(stored.op)], accepted: 1 }) as never);

    await flushOutbox();

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

describe("when the link dies", () => {
  it("puts every row back, and loses nothing", async () => {
    await enqueue(row("1"));
    await enqueue(row("2"));
    vi.spyOn(outboxApi, "sync").mockRejectedValue(new Error("Network Error"));

    await flushOutbox();

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

    await flushOutbox();

    expect((await readRow("1"))?.status).not.toBe(OUTBOX_STATUS.FAILED);
  });

  it("backs off, so a dead link is not hammered", async () => {
    await enqueue(row("1"));
    vi.spyOn(outboxApi, "sync").mockRejectedValue(new Error("Network Error"));

    await flushOutbox();

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

    await flushOutbox();

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

    await flushOutbox();

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

    await flushOutbox();

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

    await flushOutbox();

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

    const [first, second] = await Promise.all([flushOutbox(), flushOutbox()]);

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

    expect((await flushOutbox()).acked).toBe(1);
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

    const result = await flushOutbox();

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

    await flushOutbox();

    expect(sync).toHaveBeenCalledTimes(1);
  });
});
