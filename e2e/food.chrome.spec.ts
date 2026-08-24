import { test, expect, type APIRequestContext } from "@playwright/test";

import { API, foodAuth } from "./api";
import { everyRule, everythingHasAName, renderedSize, report } from "./rules";

/**
 * THE SCREENS NO BROWSER HAD EVER OPENED.
 *
 * `chrome.spec.ts` walks fourteen screens and asks the questions only a layout
 * engine can answer. It could never walk these three: the fixture shop was a
 * mart, `itemTypesFor('mart')` is ["physical_product", "deal"], and the floor,
 * the tab and the kitchen board all sit behind `dine_in`.
 *
 * So an entire vertical — the one a restaurant spends its whole service in —
 * had **no browser coverage at all**. Not a lower standard: none. Every rule
 * these screens are subject to had run zero times against them.
 *
 * The kitchen board matters most of the three. It hangs on a wall and is read
 * from two metres away by somebody with their hands full, which is the least
 * forgiving reading distance in the shop.
 */

const SCREENS: Array<{ path: string; name: string }> = [
  { path: "/tenant/dine-in", name: "the floor" },
  { path: "/tenant/kitchen", name: "the kitchen board" },
];

/**
 * A TAB WITH FOOD ON IT, FIRED.
 *
 * The kitchen board with no tickets is a heading and a sentence, and it passes
 * every rule below — nothing is covered and nothing is off the edge on a page
 * with nothing on it. That is the exact mistake the till check made once, when
 * its list held `/pos` instead of `/tenant/pos` and fourteen checks ran against
 * a redirect and passed.
 *
 * So the board is measured with a real ticket on it, and the ticket is taken
 * away afterwards: these are the QA sweep's own shops, and a tab left open is
 * a fixture the next run has to explain.
 */
// The tab to take away afterwards, registered the moment it EXISTS — not when
// the fixture finally succeeds. The first version returned null on a later
// failure and left the tab open, which occupied a real shop's table and made
// the NEXT run fail for a reason that had nothing to do with the screen.
let toClear: { id: string } | null = null;

async function aFiredTicket(request: APIRequestContext): Promise<{ id: string; table: string } | null> {
  const auth = foodAuth();

  // A FREE table, not the first one. The sweep keeps a tab open on its own
  // table all day, so `data[0]` was refused with TABLE_OCCUPIED and the whole
  // fixture returned null — which the test then reported as "could not put a
  // ticket on the pass", correctly, and for a reason that had nothing to do
  // with the board.
  const tables = await request.get(`${API}/restaurant/tables`, { headers: auth });
  if (!tables.ok()) return null;
  const table = ((await tables.json()) as {
    data: Array<{ id: string; name: string; open_ticket: unknown | null }>;
  }).data.find((t) => t.open_ticket === null);

  const menu = await request.get(`${API}/products?item_type=food_item&per_page=1`, { headers: auth });
  if (!menu.ok()) return null;
  const dish = ((await menu.json()) as { data: Array<{ id: string }> }).data[0];
  if (!table || !dish) return null;

  const opened = await request.post(`${API}/restaurant/tickets`, {
    headers: auth,
    data: { order_type: "dine_in", dining_table_id: table.id, guest_count: 2 },
  });
  if (!opened.ok()) return null;
  const ticket = ((await opened.json()) as { data: { id: string } }).data.id;
  toClear = { id: ticket };

  await request.post(`${API}/restaurant/tickets/${ticket}/items`, {
    headers: auth,
    data: { items: [{ product_id: dish.id, quantity: 2 }] },
  });
  const fired = await request.post(`${API}/restaurant/tickets/${ticket}/fire`, { headers: auth, data: {} });
  if (!fired.ok()) return null;

  // The board is asked about THIS docket, by the TABLE it belongs to. Asking
  // whether the board has anything on it proves nothing — a KOT fired on 18
  // August was still sitting on this shop's pass, so "not empty" was true
  // before the fixture existed and stayed true when the fixture was broken,
  // which is exactly what the mutation showed. And the docket NUMBER is no
  // good either: `kot_number` is a per-tab sequence, so every card on a busy
  // pass says #1.
  const kots = ((await fired.json()) as { data?: Array<{ kot_number: number }> }).data ?? [];
  if (kots.length === 0) return null;

  return { id: ticket, table: table.name };
}

async function clearTicket(
  request: APIRequestContext,
  ticket: { id: string } | null,
): Promise<void> {
  if (ticket === null) return;
  await request.post(`${API}/restaurant/tickets/${ticket.id}/cancel`, {
    headers: foodAuth(),
    data: { reason: "e2e fixture" },
  }).catch(() => {});
}

// Cleanup that survives a FAILING assertion. The first version cancelled the
// tab after the assertions, so every failed run left its tab open on a real
// shop's floor — four of them inside an hour, each one occupying a table the
// next run then could not use. A fixture that only tidies up when it passes is
// a fixture that breeds.
test.afterEach(async ({ request }) => {
  await clearTicket(request, toClear);
  toClear = null;
});

for (const screen of SCREENS) {
  test(`${screen.name} — nothing covered, nothing off the edge`, async ({ page, request }) => {
    const ticket = await aFiredTicket(request);
    expect(ticket, "could not put a ticket on the pass — the board would be measured empty")
      .not.toBeNull();

    await page.goto(screen.path);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(800);

    // THE DENOMINATOR. A screen that rendered nothing has nothing covered and
    // nothing off its edge, and passes every rule below — which is how the
    // till check once ran fourteen times against a redirect.
    const size = await renderedSize(page);
    expect(size.elements, `${screen.name} (${screen.path}) rendered almost nothing`)
      .toBeGreaterThan(40);
    expect(size.text, `${screen.name} (${screen.path}) rendered no words`)
      .toBeGreaterThan(60);

    // AND THE THING ITSELF IS ON IT. A size assertion catches a blank page; it
    // does not catch a board that renders its header, its counter and its
    // empty-pass message while the ticket sits somewhere the cook cannot see.
    // The counter is the board's own claim about how much work is on the pass,
    // so it is what gets read.
    if (screen.path.endsWith("/kitchen")) {
      await expect(
        page.getByRole("article").filter({ hasText: ticket!.table }),
        `the docket this test fired (${ticket!.table}) is not on the board — `
        + "every rule below would be measured against a page missing the thing "
        + "the board exists to show",
      ).toHaveCount(1);
    }

    const findings = await everyRule(page);

    report(
      findings,
      `${screen.name} (${screen.path}) · ${size.elements} elements, ${size.text} chars`,
    );
  });
}

test("every control on the food screens can be called by name", async ({ page, request }) => {
  void request;
  // No budget. The fourteen screens the mart can reach are all at zero, and a
  // module arriving with debt is what the ratchet in chrome.spec exists for —
  // these are not arriving, they have been shipped for months. They were simply
  // never looked at.
  const worse: string[] = [];
  let measured = 0;
  await aFiredTicket(request);

  for (const screen of SCREENS) {
    await page.goto(screen.path);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(800);

    const found = await everythingHasAName(page);
    measured += found.examined;

    console.log(
      `  ${screen.name.padEnd(20)} ${found.findings.length}/${found.examined} unnamed`
      + `, ${found.hinted} named by placeholder alone`,
    );

    if (found.findings.length > 0) {
      worse.push(
        `${screen.name}: ${found.findings.length} of ${found.examined} — `
        + found.findings.slice(0, 6).map((f) => f.what).join(", "),
      );
    }
  }

  expect(measured, "no controls were measured at all — the walk found nothing to judge")
    .toBeGreaterThan(4);
  expect(worse, `controls with no accessible name:\n${worse.join("\n")}`).toEqual([]);
});
