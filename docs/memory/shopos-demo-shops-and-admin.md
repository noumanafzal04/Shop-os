---
name: shopos-demo-shops-and-admin
description: BUILT 2026-10-09 — `php artisan demo:shops` makes shop1…shop9@johartown.demo / password (one per trade, real catalogues, real trading history); runs with --no-dev; last step of db:seed; second super admin admin@trueserve.app / Admin@123
metadata:
  type: project
---

**The user asked (2026-10-09):** shareable demo tenants with real-looking data —
`shop1@johartown.demo` / `password` a restaurant/café with 500+ products, sales,
orders, dine-in tables, kitchen tickets; shop2 a mart; one per other trade; and
a second super admin `admin@trueserve.app` / `Admin@123`. Later the same day:
"I will run migrate:fresh --seed, then add the seeder in seed to auto run these."

**What exists now**

- `php artisan demo:shops` (`app/Console/Commands/SeedDemoShops.php`) — extends
  the load test's builder (`SeedLoadTestShops`), so every sale/tab/delivery goes
  through the product's own actions; only the names and the people differ.
  Catalogues: `app/Console/Commands/DemoShops/{CafeMenu,MartShelves,TradeLists}.php`.
  Flags: `--fresh`, `--only=shop1|food|…`, `--sales=`, `--listed`.
- shop1 café 628 dishes/28 sections/8 stations/60 tables · shop2 mart 537 ·
  shop3 pharmacy 250 · shop4 clothing 82 designs (sizes) · shop5 repair centre
  83 · shop6 workshop 254 · shop7 fuels · shop8 online gadgets 110 (no till) ·
  shop9 finance. Slugs `jtdemo-…`; tenant emails `…@demo.trueserve.app` (NOT
  @johartown.demo — JoharTownSeeder owns tenants at that address and removes
  them by it).
- `DemoShopsSeeder` is the last step of `DatabaseSeeder` on every environment
  except `testing`.
- `SuperAdminSeeder`: `admin@trueserve.app` via `firstOrCreate` — a re-seed
  never puts the known password back.

**Things that would have bitten**

- **The user deploys with `composer install --no-dev`.** Factories need Faker
  (require-dev). The load test used factories in 4 places → `newTenant()` /
  `newUser()` hooks; the demo command makes rows by hand. Verified by running
  with an autoloader that throws on `Faker\`.
- A hook named `line()` collided with `Illuminate\Console\Command::line()` —
  fatal at class load, invisible to `php -l`.
- `--fresh` in the same process as a build: `auth()` still held the shop's
  owner, so auditing the tenant's deletion named a user the cascade had just
  removed (FK). `auth()->forgetGuards()` first.
- The builder had never run under SQLite: two `UPDATE products p SET` aliases.
- Online orders become `sales` rows (channel `online`) by design — "an online
  shop has no sales" is the wrong assertion; "none from a till" is the right one.

**Open:** no product photos/logos (the repo's drawn art looks worse than the
panel's initial tiles). Shops are unlisted on the marketplace by default —
`--listed` if the user wants them on the storefront. `Admin@123` must be
changed on live.

Related: [[shopos-queue-oct09]], [[shopos-demo-world-stale]], [[shopos-deployment]]
