import { test as setup, expect } from "@playwright/test";

import { API, ownerAuth } from "./api";

/** The catalog needs ENOUGH ON THE SHELF to fill a cart. */
const WANTED = 14;
const TOP_UP = 60;

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
