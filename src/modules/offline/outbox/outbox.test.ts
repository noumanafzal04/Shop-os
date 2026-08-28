import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { resetDbCache } from "../db/open";
import { getAll } from "../db/repo";
import { STORE } from "../db/schema";
import {
  allRows,
  BACKOFF_MS,
  dueRows,
  queueSummary,
  enqueue,
  KEEP_ACKED_MS,
  markAcked,
  markFailed,
  markRetry,
  markSending,
  newRow,
  OUTBOX_STATUS,
  owedCount,
  strandedRows,
  pruneAcked,
  readRow,
  recoverInFlight,
  refusedCount,
  refusedRows,
  refusedTotal,
  type OutboxRow,
} from "./outbox";
import { pendingCount } from "../db/repo";

/**
 * The queue of sales that have happened but not yet reached the server.
 *
 * The only store in the till that holds money. Every other store is a cache the
 * server can send again; a row in here is a customer who has paid and walked
 * out, and it exists nowhere else in the world.
 *
 * One asymmetry decides every doubtful case: sending a sale twice costs a
 * lookup, and not sending it at all costs the sale.
 */

/** The shop signed in for every test here — see `belongsHere`. */
const SHOP = "shop-a";

const row = (op: string, over: Partial<OutboxRow> = {}): OutboxRow => ({
  ...newRow(op, "2026-08-16T10:00:00.000Z", `OFF-L1-AB-${op}`, { total: 100 }, null, {
    tenantId: SHOP,
  }),
  ...over,
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
});

describe("queueing", () => {
  it("keeps the sale exactly as it will be sent", async () => {
    await enqueue(row("1"));

    const stored = await readRow("1");
    expect(stored?.status).toBe(OUTBOX_STATUS.PENDING);
    expect(stored?.sale).toEqual({ total: 100 });
    expect(stored?.offlineNumber).toBe("OFF-L1-AB-1");
  });

  it("counts what is owed, and does not count what has landed", async () => {
    await enqueue(row("1"));
    await enqueue(row("2", { status: OUTBOX_STATUS.SENDING }));
    await enqueue(row("3", { status: OUTBOX_STATUS.ACKED }));

    expect(await owedCount()).toBe(2);
  });

  it("counts a FAILED row as no longer owed, because retrying cannot help", async () => {
    await enqueue(row("1", { status: OUTBOX_STATUS.FAILED }));

    expect(await owedCount()).toBe(0);
  });
});

describe("what to send next", () => {
  it("sends the oldest first", async () => {
    // A queue that sent its newest first would, on a link that keeps dropping,
    // leave the oldest sale unsent for ever — and that is the one closest to
    // being forgotten by everyone who was there.
    await enqueue(row("new", { createdAt: "2026-08-16T12:00:00.000Z" }));
    await enqueue(row("old", { createdAt: "2026-08-14T09:00:00.000Z" }));

    expect((await dueRows(Date.now(), SHOP)).map((r) => r.op)).toEqual(["old", "new"]);
  });

  it("leaves another shop's rows where they are", async () => {
    // One browser, two shops: IndexedDB is scoped to the origin, not to the
    // signed-in tenant. Sending these under the wrong session would file one
    // business's takings into another's books.
    await enqueue(row("mine"));
    await enqueue(row("theirs", { tenantId: "shop-b" }));

    expect((await dueRows(Date.now(), SHOP)).map((r) => r.op)).toEqual(["mine"]);
  });

  it("does not send a row that is waiting out its backoff", async () => {
    await enqueue(row("1", { nextAttemptAt: new Date(Date.now() + 60_000).toISOString() }));

    expect(await dueRows(Date.now(), SHOP)).toEqual([]);
  });

  it("sends it once the wait is over", async () => {
    await enqueue(row("1", { nextAttemptAt: new Date(Date.now() - 1).toISOString() }));

    expect(await dueRows(Date.now(), SHOP)).toHaveLength(1);
  });

  /**
   * A SHOP PRESSED SYNC AND WAS TOLD "UP TO DATE" WITH FOUR SALES QUEUED.
   *
   * The backoff caps at ten minutes. After a few failed attempts the flush
   * found nothing DUE, sent nothing, returned instantly — and the button
   * reported success. Every part of that was working as written; the press was
   * simply being treated as a poll.
   */
  it("sends a row that is waiting, when a PERSON asked", async () => {
    await enqueue(row("1", { nextAttemptAt: new Date(Date.now() + 600_000).toISOString() }));

    expect(await dueRows(Date.now(), SHOP)).toEqual([]);
    expect(await dueRows(Date.now(), SHOP, true)).toHaveLength(1);
  });

  it("reports the queue with the same counters the badge uses", async () => {
    // The number under "Sync now" and the number on the badge are drawn on one
    // bar, three inches apart. If they are computed twice they disagree — and
    // "3 still to send" beside a badge reading 4 is no better than the "Up to
    // date" it replaced. pendingCount() counts sales AND shift events; this
    // has to count exactly what it counts.
    await enqueue(row("a"));
    await enqueue(row("b", { status: OUTBOX_STATUS.FAILED, error: "Shop refused it" }));

    const summary = await queueSummary();

    expect(summary.waiting).toBe(await pendingCount());
    expect(summary.failed).toBe(1);
    expect(summary.lastError).toBe("Shop refused it");
  });

  it("still will not send another shop's row, however hard it is pressed", async () => {
    // Forcing skips the WAIT. It must never skip the fence — a flush under the
    // wrong token files one business's takings in another's books.
    await enqueue(row("theirs", { tenantId: "someone-else", nextAttemptAt: null }));

    expect(await dueRows(Date.now(), SHOP, true)).toEqual([]);
  });

  it("never offers a row that is already in flight", async () => {
    await enqueue(row("1", { status: OUTBOX_STATUS.SENDING }));

    expect(await dueRows(Date.now(), SHOP)).toEqual([]);
  });
});

describe("in flight", () => {
  it("counts the attempt when a row goes out", async () => {
    await enqueue(row("1"));
    await markSending([await readRow("1") as OutboxRow]);

    const stored = await readRow("1");
    expect(stored?.status).toBe(OUTBOX_STATUS.SENDING);
    expect(stored?.attempts).toBe(1);
  });

  it("PUTS A ROW LEFT MID-FLIGHT BACK IN THE QUEUE", async () => {
    // The single most important behaviour in this file. The tab was closed or
    // the battery died mid-request, and nobody knows whether the server got it.
    // Left alone that row is never sent again and the sale is simply gone.
    await enqueue(row("1", { status: OUTBOX_STATUS.SENDING, attempts: 1 }));

    expect(await recoverInFlight()).toBe(1);

    const stored = await readRow("1");
    expect(stored?.status).toBe(OUTBOX_STATUS.PENDING);
    expect(await dueRows(Date.now(), SHOP)).toHaveLength(1);
  });

  it("does not reset the attempt count when recovering", async () => {
    // A row that keeps dying mid-flight has to reach its backoff eventually, or
    // a till in a crash loop hammers the server every time it opens.
    await enqueue(row("1", { status: OUTBOX_STATUS.SENDING, attempts: 4 }));

    await recoverInFlight();

    expect((await readRow("1"))?.attempts).toBe(4);
  });

  it("leaves rows that were not in flight alone", async () => {
    await enqueue(row("1", { status: OUTBOX_STATUS.ACKED }));

    expect(await recoverInFlight()).toBe(0);
    expect((await readRow("1"))?.status).toBe(OUTBOX_STATUS.ACKED);
  });
});

describe("when it lands", () => {
  it("keeps the real invoice number against the slip that was printed", async () => {
    // The slip in the customer's bag is the only reference they hold.
    await enqueue(row("1"));
    await markAcked((await readRow("1")) as OutboxRow, "INV-1043", []);

    const stored = await readRow("1");
    expect(stored?.status).toBe(OUTBOX_STATUS.ACKED);
    expect(stored?.invoiceNumber).toBe("INV-1043");
    expect(stored?.offlineNumber).toBe("OFF-L1-AB-1");
  });

  it("carries back what the shop flagged about it", async () => {
    await enqueue(row("1"));
    await markAcked((await readRow("1")) as OutboxRow, "INV-1", ["Khata needs the connection"]);

    expect((await readRow("1"))?.violations).toHaveLength(1);
  });
});

describe("when it does not land", () => {
  it("waits longer each time rather than hammering a dead link", async () => {
    await enqueue(row("1", { attempts: 2 }));
    const at = Date.parse("2026-08-16T10:00:00.000Z");

    await markRetry((await readRow("1")) as OutboxRow, "offline", at);

    const stored = await readRow("1");
    expect(stored?.status).toBe(OUTBOX_STATUS.PENDING);
    expect(Date.parse(String(stored?.nextAttemptAt))).toBe(at + BACKOFF_MS[2]);
  });

  it("caps the wait, so a till away for two days is not backed off for hours", async () => {
    await enqueue(row("1", { attempts: 99 }));
    const at = Date.parse("2026-08-16T10:00:00.000Z");

    await markRetry((await readRow("1")) as OutboxRow, "offline", at);

    expect(Date.parse(String((await readRow("1"))?.nextAttemptAt)))
      .toBe(at + BACKOFF_MS[BACKOFF_MS.length - 1]);
  });

  it("KEEPS a refused sale rather than dropping it", async () => {
    // A till that quietly discarded a refused sale would leave a customer
    // holding a receipt for something the shop has no record of, and nobody
    // would ever know to look.
    await enqueue(row("1"));
    await markFailed((await readRow("1")) as OutboxRow, "Discount exceeds subtotal");

    const stored = await readRow("1");
    expect(stored).toBeDefined();
    expect(stored?.status).toBe(OUTBOX_STATUS.FAILED);
    expect(stored?.error).toMatch(/Discount/);
    expect(stored?.sale).toEqual({ total: 100 });
  });

  it("stops offering a refused sale to the sender", async () => {
    await enqueue(row("1", { status: OUTBOX_STATUS.FAILED }));

    expect(await dueRows(Date.now(), SHOP)).toEqual([]);
  });
});

describe("pruning", () => {
  it("keeps the slip-to-invoice mapping for ever, and drops only the cart", async () => {
    // Two short strings answer "what became of OFF-L1-AB-000123". The cart
    // behind it can be hundreds of lines, and the server has had it a week.
    const old = new Date(Date.now() - KEEP_ACKED_MS - 1000).toISOString();
    await enqueue(row("1", { status: OUTBOX_STATUS.ACKED, createdAt: old, invoiceNumber: "INV-9" }));

    expect(await pruneAcked()).toBe(1);

    const stored = await readRow("1");
    expect(stored?.offlineNumber).toBe("OFF-L1-AB-1");
    expect(stored?.invoiceNumber).toBe("INV-9");
    expect(stored?.sale).toEqual({});
  });

  it("never prunes a sale that has not landed, however old", async () => {
    // The one that would lose money. Age is not evidence of arrival.
    const ancient = new Date(Date.now() - KEEP_ACKED_MS * 10).toISOString();
    await enqueue(row("1", { status: OUTBOX_STATUS.PENDING, createdAt: ancient }));

    expect(await pruneAcked()).toBe(0);
    expect((await readRow("1"))?.sale).toEqual({ total: 100 });
  });

  it("leaves a recently acked sale intact", async () => {
    await enqueue(row("1", { status: OUTBOX_STATUS.ACKED }));

    expect(await pruneAcked()).toBe(0);
  });
});

describe("the store itself", () => {
  it("holds one row per operation, so a re-queue cannot double a sale", async () => {
    await enqueue(row("1"));
    await enqueue(row("1"));

    expect(await allRows()).toHaveLength(1);
    expect(await getAll(STORE.OUTBOX)).toHaveLength(1);
  });
});

describe("sales the server refused for good", () => {
  it("counts them, because nothing else does", async () => {
    // The gap this closes: `owedCount` correctly leaves a refused row out —
    // retrying cannot help — and that left it in no count at all. The pill
    // read "Online" while the till held a sale the shop had taken money for
    // and the server had never recorded.
    await enqueue(row("1", { status: OUTBOX_STATUS.FAILED }));
    await enqueue(row("2"));
    await enqueue(row("3", { status: OUTBOX_STATUS.ACKED }));

    expect(await owedCount(), "still to send").toBe(1);
    expect(await refusedCount(), "owed to a person, not to the server").toBe(1);
  });

  it("says nothing when a queue is merely draining", async () => {
    await enqueue(row("1"));
    await enqueue(row("2", { status: OUTBOX_STATUS.SENDING }));

    expect(await refusedCount()).toBe(0);
  });

  it("hands back the newest first, with what the server said", async () => {
    // Newest first because the customer most likely to still be findable is
    // the one who left most recently.
    await enqueue(row("old", { status: OUTBOX_STATUS.FAILED, at: "2026-08-16T09:00:00.000Z", error: "Insufficient stock: only 0 in stock." }));
    await enqueue(row("new", { status: OUTBOX_STATUS.FAILED, at: "2026-08-16T11:00:00.000Z", error: "Item may not be sold offline." }));

    const rows = await refusedRows();

    expect(rows.map((r) => r.op)).toEqual(["new", "old"]);
    expect(rows[0].error, "the server's own words, so the shop can act").toBe("Item may not be sold offline.");
  });

  it("reads the amount off the sale, and admits when it cannot", async () => {
    // "Rs 0" would read as a sale worth nothing, which is a different story
    // from one whose amount this build cannot parse.
    expect(refusedTotal(row("1"))).toBe(100);
    expect(refusedTotal(row("2", { sale: {} }))).toBeNull();
    expect(refusedTotal(row("3", { sale: { total: "250.50" } }))).toBe(250.5);
  });
});

describe("a status this build does not recognise", () => {
  it("still counts as money owed", async () => {
    // The outbox is append-only and is read by app versions newer than the one
    // that wrote a row. Counting only the statuses we know would report zero
    // owed while the till was still holding sales — and nobody would ask.
    await enqueue(row("1", { status: "queued" as OutboxRow["status"] }));

    expect(await owedCount()).toBe(1);
  });

  it("does not count one that is definitively finished", async () => {
    await enqueue(row("1", { status: OUTBOX_STATUS.ACKED }));
    await enqueue(row("2", { status: OUTBOX_STATUS.FAILED }));

    expect(await owedCount()).toBe(0);
  });
});

describe("a row nobody stamped is money nobody can send", () => {
  /**
   * `tenantId: user?.tenant?.id ?? null` is how the till stamps a queued sale.
   * If the auth store has not hydrated its tenant at the moment Complete is
   * pressed — an offline boot, a reload mid-outage — the row is written with
   * NO shop on it.
   *
   * `owedCount()` then counts it, because it counts everything unfinished.
   * `dueRows()` never returns it, because `belongsHere` demands an exact
   * match. So the badge says 7, every press of Sync sends nothing, and there
   * is no screen anywhere that explains why.
   */
  it("is counted by the badge and never offered to the flush", async () => {
    // HELD ON PURPOSE — see the fence in flush.test.ts: a stuck row can be
    // read and recovered, a row filed under the wrong business cannot. What
    // was wrong is that "can be read and recovered" was not true of anything:
    // the badge counted it, Sync silently did nothing, and no screen said why.
    // `strandedRows()` is what makes the promise good.
    await enqueue(row("unstamped", { tenantId: null }));

    expect(await owedCount()).toBe(1);
    expect(await dueRows(Date.now(), SHOP)).toEqual([]);
    expect(await dueRows(Date.now(), SHOP, true)).toEqual([]);
  });

  it("names the rows that are stuck, so the count can be explained", async () => {
    await enqueue(row("mine"));
    await enqueue(row("unstamped", { tenantId: null }));
    await enqueue(row("theirs", { tenantId: "another-shop" }));

    const stranded = await strandedRows(SHOP);

    expect(stranded.map((r) => r.op).sort()).toEqual(["theirs", "unstamped"]);
  });
});
