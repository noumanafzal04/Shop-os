import { expect, test } from "@playwright/test";

import { openTill, showPane } from "./till";

/**
 * A SALE THE SERVER REFUSED, AND WHETHER THE TILL SAYS SO.
 *
 * The money is in the drawer and there is no sale against it. That is the whole
 * severity of this: the outbox row was marked `failed`, dropped out of the
 * "still to send" count, and the pill went back to reading "Online". The day
 * closed over by the amount and nobody could say why.
 *
 * Driven from a browser rather than jsdom because the defect this guards
 * against is a LAYOUT one and jsdom cannot see layout. The last warning this
 * till learned to raise was drawn into the Products pane, and a phone shows one
 * pane at a time — so on the narrowest screen in the shop it was not hidden and
 * not missing, it was somewhere else, which from the counter is the same thing.
 * That was found by the 390-point project and by nothing else.
 *
 * The refusal itself is seeded rather than provoked. Making a real server say
 * no needs a race between a stale mirror and a depleted shelf, which is a
 * fixture that would fail for reasons of its own; what is under test here is
 * whether a refused row REACHES A PERSON, and that begins with the row.
 */
async function seedRefusedSale(page: import("@playwright/test").Page): Promise<void> {
  const outcome = await page.evaluate(async () => {
    /**
     * BOUNDED, AND IT SAYS WHY IT GAVE UP.
     *
     * The first version awaited `indexedDB.open` with only `onsuccess` and
     * `onerror` wired. A blocked open fires NEITHER — it fires `onblocked` —
     * so the promise never settled, `page.evaluate` never returned, and a
     * fifteen-second test sat there until the five-minute deadline killed it.
     * The report said "timed out", which is true and names nothing.
     *
     * A helper that can hang is a helper that will one day cost somebody an
     * afternoon reading the wrong file.
     */
    const settle = <T,>(work: Promise<T>, ms: number, what: string): Promise<T> =>
      Promise.race([
        work,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`gave up after ${ms}ms: ${what}`)), ms),
        ),
      ]);

    const db = await settle(
      new Promise<IDBDatabase>((resolve, reject) => {
        // No version: attach to whatever the app already built. Naming one
        // would trigger an upgrade against a schema this file does not own.
        const req = indexedDB.open("shopos-till");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(new Error("the till database would not open"));
        req.onblocked = () => reject(new Error("the till database is blocked by another connection"));
      }),
      10_000,
      "opening the till database",
    );

    if (!db.objectStoreNames.contains("outbox")) {
      db.close();

      throw new Error("the till has not built its outbox yet — seeded too early");
    }

    await settle(
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction("outbox", "readwrite");
        tx.objectStore("outbox").put({
          op: "e2e-refused-1",
          at: new Date().toISOString(),
          offlineNumber: "OFF-TILL-E2E-000042",
          offlineSince: null,
          tenantId: null,
          sale: { total: 1250 },
          training: false,
          status: "failed",
          createdAt: new Date().toISOString(),
          attempts: 1,
          nextAttemptAt: null,
          error: "Insufficient stock: only 0 in stock.",
          invoiceNumber: null,
          violations: [],
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error("could not write the refused row"));
        tx.onabort = () => reject(new Error("the write was aborted"));
      }),
      10_000,
      "writing the refused row",
    );

    db.close();

    return "seeded";
  });

  expect(outcome, "the refused row was never seeded").toBe("seeded");
}

test("a refused offline sale is on screen, on the pane the cashier is looking at", async ({ page }) => {
  await openTill(page);
  await seedRefusedSale(page);

  // The count is re-read when a sale is queued, on boot, and on a flush. A
  // reload is the boot path and needs no offline state to arrange.
  await page.reload();
  await openTill(page);

  /**
   * The copy that is ACTUALLY ON SCREEN, and there must be exactly one.
   *
   * The strip is drawn twice — once for the phone's stacked layout, once inside
   * the catalog pane — with CSS deciding which. So `.first()` is the wrong
   * question: on a wide screen it resolves to the phone copy, which is
   * correctly hidden, and the test then reports the till as silent about money
   * it took. That is a test bug wearing a product bug's clothes.
   *
   * `toHaveCount(1)` rather than `toBeVisible()` because it catches the other
   * half too: two copies on screen at once is its own defect, and a check that
   * only asks "is at least one visible" would pass through it.
   */
  const strip = page.locator("[data-pos-refused]:visible");

  // BOTH panes, because a phone shows one at a time and a warning in the pane
  // nobody is looking at is not a warning. On wider screens both panes are up
  // and `showPane` is a no-op, which is the right answer there.
  for (const pane of ["Products", "Cart"] as const) {
    await showPane(page, pane);
    await expect(
      strip,
      `a sale was refused and the ${pane} pane does not show exactly one notice about it`,
    ).toHaveCount(1);
  }

  // And it must lead somewhere. A count with no way to see WHICH sale is a
  // number a shopkeeper can do nothing with.
  await strip.getByRole("button", { name: /see which/i }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog, "the slip number is the only thing this list and the customer's paper share")
    .toContainText("OFF-TILL-E2E-000042");
  await expect(dialog, "the server's own words, so the shop knows what to fix")
    .toContainText("Insufficient stock");
  await expect(dialog, "what the drawer is over by").toContainText("1,250");
});
