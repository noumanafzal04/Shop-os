import { test, expect } from "@playwright/test";

import { API, ownerAuth } from "./api";
import { fillCart, showPane } from "./till";

/**
 * A TILL THAT REBOOTS INTO AN OUTAGE.
 *
 * The offline module was built so a shop can trade through a power cut, and
 * then gated behind a shift that needed the server.
 * `docs/decisions/shopos-offline-shift-gap.md` records the whole chain: the
 * shift lived in a plain `useQuery` with no persistence, so an outage with the
 * page still mounted sold fine — the case that was tested — while a RELOAD left
 * the entire offline module behind a gate that needed the server it was built
 * to do without.
 *
 * The mirror, the local session, the queue and `/pos/sync/shifts` have all
 * shipped since. **None of it had ever run in a browser.**
 *
 * That distinction has cost this repo five bugs once already: jsdom reports
 * `navigator.onLine === true` no matter what, so every offline unit test in the
 * suite is an online test wearing an offline test's name.
 * `context.setOffline(true)` is the only thing in this project that can put the
 * app in the state a shop is actually in.
 *
 * So this drives the loop the way a shop does after a power cut: reboot with no
 * line, open a drawer, sell, count it out — and only then ask the SERVER what
 * it thinks happened.
 */

/** One id per project, for the same reason `selling.spec.ts` needs one. */
function deviceIdFor(project: string): string {
  return `e2e-shift-${project}`.padEnd(36, "0").slice(0, 36);
}

/** A float nobody else will have used, so the shift can be found again. */
function floatFor(project: string): number {
  // Position-weighted, because a plain sum of char codes is an anagram hash:
  // "desktop" and "phone" both landed on 9,000, so two projects hunted the
  // same shift and each found the other's.
  const n = [...project].reduce((a, c, i) => a * 31 + c.charCodeAt(0) * (i + 1), 7);

  // A whole number of 1,000s: the shop's default is a note-by-note count, and
  // one denomination has to be able to make the figure exactly.
  return 3000 + (Math.abs(n) % 90) * 1000;
}

interface Session {
  id: string;
  status: string;
  opening_float: number | string;
  counted_cash: number | string | null;
}

type Requester = { get: (u: string, o: object) => Promise<{ json: () => Promise<unknown> }> };

async function sessions(request: Requester, auth: Record<string, string>): Promise<Session[]> {
  /**
   * `from` far enough back to see a shift nobody closed.
   *
   * `/pos/sessions` defaults to `now()->startOfDay()`, so a till left open
   * overnight is invisible to it — and this spec's cleanup, which asks for the
   * open shifts and closes them, read that empty answer as "there are none".
   *
   * The result was not a clean failure. The cleanup closed nothing, the till
   * booted still believing a drawer was open, and the assertion that fired was
   * "a till with no shift and no line offered no way to open one — this is the
   * whole bug" — pointing at the product, about a leftover from a run somebody
   * had killed the evening before. A precondition that cannot see far enough
   * back is a precondition that lies.
   */
  // No `status` filter: the cleanup wants the OPEN ones and the verification at
  // the bottom wants the CLOSED one this test just synced. Filtering here for
  // the first hid the second, and the failure read "the shift opened offline
  // never reached the server" about a shift that had arrived perfectly well.
  const res = await request.get(`${API}/pos/sessions?from=2020-01-01`, { headers: auth });
  const body = (await res.json()) as { data?: { sessions?: Session[] } | Session[] };
  const d = body.data;

  return Array.isArray(d) ? d : (d?.sessions ?? []);
}

test("a till that reboots into an outage opens its own drawer and counts it out", async ({
  page,
  context,
  request,
  browserName,
}) => {
  const auth = ownerAuth();
  const float = floatFor(test.info().project.name);

  await page.addInitScript((id: string) => {
    localStorage.setItem("shopos-device-id", id);
  }, deviceIdFor(test.info().project.name));

  // ── hand the till back BEFORE the device ever sees it ────────────────
  //
  // Order matters, and getting it wrong made this test pass alone and fail in
  // a suite. The device mirrors whatever shift it last saw so it can keep
  // selling through an outage — so priming the page first and closing the
  // shift behind its back leaves the till, correctly, still believing a drawer
  // is open. That is the mirror doing its job; it is not a state any shop
  // reaches, and a test must not invent one.
  for (const s of (await sessions(request, auth)).filter((x) => x.status === "open")) {
    await request.post(`${API}/pos/session/close`, {
      headers: auth,
      data: { counted_cash: Number(s.opening_float) || 0 },
    });
  }
  // And say so if one survived. A shift this spec could not close makes every
  // assertion below describe something other than what it claims to.
  const stubborn = (await sessions(request, auth)).filter((x) => x.status === "open");
  expect(
    stubborn.length,
    `${stubborn.length} shift(s) are still open after cleanup — the till will boot believing a drawer is open, `
      + "and everything below would be measuring that instead of an outage",
  ).toBe(0);

  const before = (await sessions(request, auth)).filter((s) => Number(s.opening_float) === float).length;

  // ── prime the device while the line is still up ──────────────────────
  //
  // The till sells offline from its OWN copy of the catalog, pulled on boot.
  // Without this the offline pane is empty and the test fails for a reason
  // that is about timing rather than about shifts.
  await page.goto("/tenant/pos");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(3000);

  // ── the line drops, and the tablet reboots ───────────────────────────
  await context.setOffline(true);
  expect(
    await page.evaluate(() => navigator.onLine),
    "the browser did not actually go offline — every assertion below would be about an online till",
  ).toBe(false);

  // ── the reboot, where the browser can do one ─────────────────────────
  //
  // WebKit throws "internal error" out of `reload()` while offline — observed,
  // and from here there is no telling whether that is the browser or the
  // driver. Either way it is the HARNESS, not the till.
  //
  // The iPad and the iPhone still run everything else, and that is the point of
  // not simply skipping them: the reboot is one line, and the layout those two
  // projects exist for — a drawer opened and counted on a 390-point screen — is
  // the thing this repo has repeatedly got wrong. Only Chromium can prove the
  // reboot itself, and it does, on every run.
  if (browserName === "webkit") {
    test.info().annotations.push({
      type: "partial",
      description: "reload-while-offline is unavailable in WebKit; the drawer is still opened, sold from and counted out with no line",
    });
  } else {
    await page.reload();
  }
  await page.waitForTimeout(2500);

  // ── open a drawer with no server ─────────────────────────────────────
  const openBtn = page.getByRole("button", { name: /^Open shift$/ }).first();
  await expect(
    openBtn,
    "a till with no shift and no line offered no way to open one — this is the whole bug",
  ).toBeVisible({ timeout: 15_000 });
  await openBtn.click();

  const dialog = page.getByRole("dialog");
  const floatBox = dialog.locator("input[type=number]").first();
  if (await floatBox.isVisible().catch(() => false)) await floatBox.fill(String(float));
  // "Open", exactly. The dialog's own heading is "Open shift" and the button
  // that confirms it is not — matching loosely picks the heading's sibling.
  await dialog.getByRole("button", { name: /^Open(ing…)?$/ }).last().click();
  await page.waitForTimeout(2000);

  // ── and it must actually SELL, which is the point of a drawer ────────
  const lines = await fillCart(page, 1);
  expect(lines, "the drawer opened offline but the till would not take a line").toBe(1);

  // ── PARK A TICKET WITH NO LINE, AND PICK IT UP AGAIN ────────────────
  //
  // The queue behind a customer who has gone back for the milk is exactly when
  // a till needs to park a ticket, and an outage does not make that customer
  // patient. Online a parked ticket is shop-wide and resumed by a locked claim;
  // offline it is parked on THIS till, and the till says so on the row.
  //
  // This screen used to refuse all three of hold, resume and the list, three
  // days after `heldLocal.ts` and its wiring in `usePos` had shipped — each
  // fence propping up the next.
  await page.getByRole("button", { name: /Hold/i }).first().click();
  await page.waitForTimeout(400);
  const holdDialog = page.getByRole("dialog");
  // A bare <input> with no `type`, so `input[type=text]` matches nothing —
  // the attribute selector needs the attribute to be present.
  const labelBox = holdDialog.getByPlaceholder(/Customer name/i).first();
  if (await labelBox.isVisible().catch(() => false)) await labelBox.fill("Milk run");
  // "Hold ticket" — the dialog's confirm. `/^Hold$/` matched nothing, so the
  // modal simply stayed open and the check tested a button nobody pressed.
  const holdConfirm = holdDialog.getByRole("button", { name: /^Hold ticket$/ }).last();
  await expect(holdConfirm, "the hold dialog offered nothing to confirm with").toBeVisible({ timeout: 8000 });
  await holdConfirm.click();
  await page.waitForTimeout(600);

  // `:visible`, because the strip is drawn once per layout and CSS picks. A
  // plain text match finds both and Playwright's strict mode refuses — rightly.
  await expect(
    page.locator("[data-pos-notice]:visible"),
    "the ticket was parked with no line and the till did not say WHERE — a cashier who "
      + "thinks it is on the shared list sends the customer to another lane",
  ).toContainText(/Parked on this till/i, { timeout: 8000 });

  // Parking clears the cart. If it did not, everything below is measuring a
  // basket that was never parked at all.
  await showPane(page, "Cart");
  expect(
    await page.locator("[data-cart-row]").count(),
    "the ticket was parked and the basket was still on screen",
  ).toBe(0);

  // The list must show what THIS till holds, and must not claim to know the
  // shared one — the worse lie is "No held sales" over ten parked tickets.
  await page.getByRole("button", { name: /Drafts/i }).first().click();
  const draftList = page.getByRole("dialog");
  await expect(
    draftList.getByText("Milk run"),
    "a ticket parked on this till was not in this till's own list",
  ).toBeVisible({ timeout: 8000 });
  await expect(
    draftList.getByText(/this till only/i),
    "the row did not say the ticket cannot be picked up at another lane",
  ).toBeVisible({ timeout: 8000 });
  await expect(
    draftList.getByText(/shared list cannot be read/i),
    "the list showed local tickets and implied that was all of them",
  ).toBeVisible({ timeout: 8000 });

  // And it comes BACK. A park with no recall is a basket thrown away politely.
  await draftList.getByRole("button", { name: /^Resume$/ }).first().click();
  await page.waitForTimeout(800);
  await showPane(page, "Cart");
  expect(
    await page.locator("[data-cart-row]").count(),
    "the parked ticket was resumed with no line and the basket did not come back",
  ).toBe(1);

  await page.getByRole("button", { name: /Tender \/ Pay/i }).click();
  await page.getByRole("button", { name: /^Complete sale/ }).click();
  await expect(
    page.getByRole("heading", { name: "Sale complete" }),
    "a drawer opened offline could not ring a sale",
  ).toBeVisible({ timeout: 25_000 });

  const slip = await page.locator("[data-sale-invoice]").getAttribute("data-sale-invoice");
  expect(slip, "a sale rung offline must carry its own slip number").toMatch(/^OFF-/);

  await page.getByRole("button", { name: "New sale" }).click();
  await page.waitForTimeout(500);

  // ── the denominator: the server has none of this yet ─────────────────
  //
  // Playwright's `request` fixture is its own context and is NOT taken offline
  // with the page. If the shift were already there, everything above would have
  // been an ordinary online shift wearing an offline test's name.
  const during = (await sessions(request, auth)).filter((s) => Number(s.opening_float) === float).length;
  expect(
    during,
    "the server gained the shift while the till was offline — so it was never offline",
  ).toBe(before);

  // ── count it out, still with no line ─────────────────────────────────
  //
  // Counting the drawer is the shop's own control over its own cash, done when
  // the cashier hands over — not whenever the internet comes back.
  await showPane(page, "Cart");
  await page.getByRole("button", { name: /^Close shift$/ }).first().click();
  await page.waitForTimeout(1200);

  // Two shapes, because the shop chooses: a single total, or a note-by-note
  // count that adds itself up. `pos_denomination_count` defaults ON, so the
  // grid is what a shop actually sees — and a test that only knew about the
  // single box would have been testing a screen almost nobody has.
  // The Z-read is PROVISIONAL offline — the plan always said so and the till
  // never did. Every figure a shift is judged on is the server's arithmetic
  // over what the server holds, and it does not yet hold this device's queue.
  await expect(
    page.getByText(/provisional until then/i),
    "the drawer was counted out with work still on the device and the till said nothing",
  ).toBeVisible({ timeout: 8000 });

  const dialogNow = page.getByRole("dialog");
  const noteBox = dialogNow.locator("input[data-denomination]").first();

  if (await noteBox.isVisible().catch(() => false)) {
    // The float is a whole number of 1,000s on purpose, so one denomination
    // counts it out exactly and the total the modal derives is the figure the
    // server is later asked about.
    await dialogNow.locator('input[data-denomination="1000"]').fill(String(float / 1000));
  } else {
    const countBox = dialogNow.locator("input[type=number]").first();
    await expect(
      countBox,
      "the close-shift dialog offered nowhere to enter what was counted",
    ).toBeVisible({ timeout: 10_000 });
    await countBox.fill(String(float));
  }
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Close shift$/ })
    .last()
    .click();
  await page.waitForTimeout(2500);

  // ── the line comes back ──────────────────────────────────────────────
  await context.setOffline(false);
  await page.waitForTimeout(1500);

  const pill = page.getByRole("button", { name: /Offline|No server|saved here|Online|Sending/ }).first();
  if (await pill.isVisible().catch(() => false)) await pill.click();

  // ── and only now, what the SERVER has ────────────────────────────────
  let landed: Session | undefined;
  for (let i = 0; i < 12 && !landed; i++) {
    await page.waitForTimeout(2500);
    landed = (await sessions(request, auth)).find((s) => Number(s.opening_float) === float);
  }

  expect(
    landed,
    "the shift opened offline never reached the server — it exists only on the device",
  ).toBeTruthy();

  // Opened AND counted. A shift that syncs open but never closed leaves the
  // shop unable to bank its own day — the half of this that a "did it sync?"
  // check would happily miss.
  expect(
    landed?.status,
    "the shift reached the server but is still open — the count never followed it",
  ).toBe("closed");
  expect(
    Number(landed?.counted_cash),
    "the shift closed on the server without the figure the cashier actually counted",
  ).toBe(float);
});
