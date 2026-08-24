import { test as setup, expect } from "@playwright/test";

import config from "../playwright.config";

import { API, ownerAuth } from "./api";

/** The catalog needs ENOUGH ON THE SHELF to fill a cart. */
const WANTED = 14;

/**
 * ENOUGH FOR EVERY PROJECT THAT WILL DRAW ON IT.
 *
 * Playwright runs a dependency project ONCE, so this shelf is stocked once and
 * then sold from by every project that depends on it — four device sizes, each
 * running the selling and size-picker specs.
 *
 * A flat 60 was marginal at that. The offline spec failed on the LAST two
 * device sizes with "Insufficient stock: only 0 in stock", which is a sync
 * error that reads exactly like a product bug and is a fixture that ran out.
 *
 * A bigger constant would be the same fragility with a longer fuse, and the
 * number would have to be revisited by whoever adds the fifth size — which is
 * to say, never. Counting the dependents means the next one pays for itself.
 */
const PER_PROJECT = 60;
const DRAWS_ON_THE_SHELF = (config.projects ?? [])
  .filter((p) => (p.dependencies ?? []).includes("shelf")).length || 1;
const TOP_UP = PER_PROJECT * DRAWS_ON_THE_SHELF;

/**
 * Put stock on the shelf before any layout test opens the till.
 *
 * The till disables a tracked product it has none of — correctly. The sweep's
 * mart has 28 products and stock on FIVE of them, so the first version of the
 * full-cart test could only ring five lines and never reproduce what the shop
 * saw with nine.
 *
 * That is exactly the failure this suite exists to catch, one level up: a test
 * that cannot assemble its own subject passes by describing something else. So
 * the fixture is built HERE, explicitly, and the layout specs stay pure reads —
 * `auth.setup.ts` still creates nothing, and neither does `chrome.spec.ts`.
 *
 * Idempotent: it tops products up to a working level and says how many it got.
 * If it cannot get enough, it FAILS — a thin shelf must stop the suite, not
 * quietly shrink what the suite is able to see.
 */
setup("stock the shelf so a cart can be filled", async ({ request }) => {
  const auth = ownerAuth();

  // ── what is already on the shelf ─────────────────────────────────────
  const list = await request.get(`${API}/products?per_page=100`, { headers: auth });
  expect(list.ok(), `catalog unreadable (${list.status()})`).toBeTruthy();

  const body = (await list.json()) as {
    data: Array<{ id: string; name: string; item_type?: string; track_inventory?: boolean }>;
  };

  // Only what a shelf can hold. A service has no stock to give it.
  const shelvable = body.data.filter(
    (p) => p.track_inventory !== false && p.item_type !== "service",
  );

  // ── enough of them ───────────────────────────────────────────────────
  //
  // The mart has five live products: the sweep creates a handful and deletes
  // most of what it makes. Five lines is not the cart the shop was looking at,
  // so the fixture makes up the difference under its own name and reuses them
  // on every later run.
  const mine = new Map(shelvable.map((p) => [p.name, p.id]));
  for (let i = mine.size; i < WANTED; i++) {
    const name = `E2E Shelf Item ${String(i + 1).padStart(2, "0")}`;
    if (mine.has(name)) continue;
    const made = await request.post(`${API}/products`, {
      headers: auth,
      data: {
        item_type: "physical_product",
        name,
        price: 100 + i,
        cost: 60 + i,
        tax_rate: 0,
        track_inventory: true,
      },
    });
    if (!made.ok()) continue;
    const created = (await made.json()) as { data: { id: string } };
    mine.set(name, created.data.id);
  }

  // ── one product with SIZES ───────────────────────────────────────────
  //
  // The size picker is the one feature on the till whose whole risk is layout:
  // a row of chips inside a tile that is about 120 points wide on a shop
  // monitor and shares a 390-point screen with the cart on a phone. jsdom has
  // no layout engine and cannot see any of that, so a sized product has to be
  // ON the shelf for the browser suite to have something to measure.
  //
  // Created here rather than inside a spec because a fixture belongs in a
  // fixture — a spec that makes its own catalogue is a spec that fails for
  // reasons about setup.
  const SIZED = "E2E Sized Item";
  if (!mine.has(SIZED)) {
    const made = await request.post(`${API}/products`, {
      headers: auth,
      data: {
        item_type: "physical_product",
        name: SIZED,
        price: 500,
        cost: 300,
        tax_rate: 0,
        track_inventory: true,
        // Three prices that are obviously different, so a test asserting the
        // cart total cannot pass on the parent's price by coincidence.
        variants: [
          { name: "Small", price: 500, stock_quantity: TOP_UP },
          { name: "Medium", price: 750, stock_quantity: TOP_UP },
          { name: "Large", price: 900, stock_quantity: TOP_UP },
        ],
      },
    });
    if (made.ok()) {
      const created = (await made.json()) as { data: { id: string } };
      mine.set(SIZED, created.data.id);
    }
  }

  // ── and its sizes are topped up, EVERY run ───────────────────────────
  //
  // Creating them once was not enough, and the way that failed is why this block
  // exists. Each of the four viewport projects sells one Large, the sweep's own
  // phase U sells more, and the sizes started at five — so a later project met a
  // struck-through chip and Playwright sat on the click for its full five-minute
  // timeout before failing. Four of those is most of an hour, which is how a
  // missing top-up reads from the outside: not obviously wrong, just slow, and
  // then wrong.
  //
  // The product-level loop below cannot do this job. A varianted product's own
  // stock row is the orphan this whole feature is about, and setting it moves
  // nothing a size chip can see.
  const sizedId = mine.get(SIZED);
  if (sizedId !== undefined) {
    const res = await request.get(`${API}/products?search=${encodeURIComponent(SIZED)}`, { headers: auth });
    const rows = ((await res.json()) as { data: Array<{ id: string; variants?: Array<{ id: string }> }> }).data;
    for (const v of rows.find((r) => r.id === sizedId)?.variants ?? []) {
      await request.post(`${API}/inventory/adjust`, {
        headers: auth,
        data: {
          product_id: sizedId, variant_id: v.id,
          type: "set", new_quantity: TOP_UP, reason: "e2e shelf sizes",
        },
      });
    }
  }

  // ── stock ────────────────────────────────────────────────────────────
  let stocked = 0;
  for (const id of mine.values()) {
    const res = await request.post(`${API}/inventory/adjust`, {
      headers: auth,
      data: { product_id: id, type: "set", new_quantity: TOP_UP, reason: "e2e shelf" },
    });
    if (res.ok()) stocked += 1;
  }

  expect(
    stocked,
    `only ${stocked} of ${mine.size} products could be stocked — ` +
      `the till cannot show a cart of ${WANTED} lines`,
  ).toBeGreaterThanOrEqual(WANTED);
});

/**
 * OFFLINE SELLING IS A GRANT, NOT A SHOP SETTING.
 *
 * `offline_selling` is a plan limit the platform assigns to a tenant — a shop
 * cannot turn it on for itself, by design. A till whose shop was never granted
 * it refuses every offline sale, correctly, and `selling.spec.ts` would then be
 * testing the refusal while claiming to test offline selling.
 *
 * So this asserts rather than fixes: the grant is not reachable from the tenant
 * API, and a setup that silently skipped would leave the offline spec passing
 * against a shop that cannot sell offline at all.
 */
setup("the fixture shop is allowed to sell offline", async ({ request }) => {
  const auth = ownerAuth();

  const res = await request.get(`${API}/pos/catalog`, { headers: auth });
  expect(res.ok(), `the till's catalog call failed (${res.status()})`).toBeTruthy();

  // `offline_selling` sits on the catalog envelope itself, beside
  // `offline_days` — NOT inside `settings`, which carries the shop's own
  // preferences. A grant is not a preference.
  const body = (await res.json()) as { data?: { offline_selling?: boolean } };
  const granted = body.data?.offline_selling;

  expect(
    granted,
    "this shop has not been granted offline selling, so every offline sale will be " +
      "refused. Grant it once, from the repo root:\n\n" +
      "  cd shopos-backend && php artisan tinker --execute='" +
      '$t = App\\Models\\User::where("email","sweep-mart@qa.test")->first()->tenant; ' +
      "$l = $t->limits ?? []; $l[\"offline_selling\"] = 1; $t->limits = $l; $t->save();'\n",
  ).toBe(true);
});
