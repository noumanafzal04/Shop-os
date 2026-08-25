# The demo world catches up with the product

**2026-08-26.** `DemoDataSeeder`, `DemoWorldIsCompleteTest`.

## What was asked

"Any changes needed now on demo seeder?"

## What was true

It ran. `migrate:fresh --seed` exited 0 and printed nine shops. It had not been
edited since `a6498c6` on 9 August, while roughly fifteen features shipped past
it.

**A seeder that still runs is not a seeder that still covers the product.**

The evidence was a per-tenant census taken against a scratch SQLite database —
not a reading of the file. Two findings were worse than "thin":

| Shop | Module | Behind it |
|---|---|---|
| Karahi House | `dine_in` **on** | 0 tables, 0 tabs, 0 dockets |
| Highway Fuel | `fuel` **on** | 0 tanks, 0 pumps, 0 nozzles |

A module that is on and empty does not read as unconfigured. It reads as
broken. And the forecourt was not merely empty: `OpenForecourtShiftAction`
refuses with `NO_FORECOURT_CONFIGURED` when a branch has no tank, so the
station could not open a shift at all. Unit 11 was unreachable in the demo.

A third was the one a developer meets first: **Demo Mart**, the tenant
`DemoTenantSeeder` creates so `owner@demomart.test / password` survives a
`migrate:fresh`, had every module a mart gets and no content whatsoever. The
credentials printed in `DemoDataSeeder`'s own docblock opened an empty shop.

## A reader with no writer, three times in one file

`product_variants` was 0 across the whole demo world. The seeder has had this
since the first import:

```php
foreach ($item['variants'] ?? [] as $variant) { … }
```

…and **no catalog anywhere supplied a `variants` key**. Same shape for
`modifiers`. Same shape, again, for barcodes: `products.barcode` was null on
every row and `product_barcodes` was empty, so the scanner box — the most-used
control on the till — had nothing to find in any demo shop.

Everything built on sizes therefore had no demo data at all: the picker,
per-size stock, per-size 86, per-size recipes, a deal that names a size,
variant barcodes. This is the same class as [a code for each
size](shopos-a-code-for-each-size.md), one layer out: the *seeder* had the
reader and no writer.

Worth noting for anyone extending this: `seedSales` and `seedPurchases` both
say `doesntHave('variants')`. They were written before sizes existed. Adding
variants does not make one get **sold** — `seedSizedSale` exists for that.

## What is seeded now

All of it through the real actions, never written straight to a table. A
hand-written refund restocks nothing and proves nothing; the same is true of a
hand-written serial, transfer or forecourt reading.

- **The floor** — 13 tables in three areas, one tab fired and on the pass, one
  still being keyed. Two states, because the floor and the kitchen board answer
  different questions.
- **The forecourt** — a tank per grade dipped at exactly the litres the catalog
  says are in stock, two pumps, every pump reaching every grade, one reconciled
  shift (12 litres short on one tank) and one running.
- **Sizes** — food and garments. The parent holds no stock of its own; see
  `Product::stockOnHand()`, which sums the variants.
- **The kitchen** — ingredients to cost a dish from, recipes with per-size
  **overrides** (a Large is made differently, not additionally), deals
  including one that names a size, and 86 in both shapes: a whole dish off, and
  only the large wings off.
- **The counter** — serials received / sold / claimed on, an open claim and a
  resolved one, vehicles, a trade-in as a **tender**, khata charge + part
  payment, points earned + redeemed.
- **The shelf** — lots with a real spread of dates, DOT codes on tyres, a stock
  count that found a variance, a transfer between the chain's branches, and
  both disposal dispositions.
- **The rest** — registers and the hardware on them, cash movements in both
  directions, coupons (one live, one expired), banks and a deposit, packs,
  riders, enquiries in both kinds and three states, and a demo shop asking to
  be kept.

## Three things this cost

### Exit 0 and no warning is not success

The first equipment pass was called beside `seedExtraBranches`, which runs
*before* the catalog. Every method found no products and returned. Thirteen
dining tables appeared, nothing else did, and the run was green with no warning
— the methods had not thrown, they had simply had nothing to do.

The row count is what told the truth. Same family as
[shopos-measurement-that-lied.md](../memory/shopos-measurement-that-lied.md).

### The seeder must not compute a total

A khata tender must equal the bill exactly — the counter cannot hand back cash
change against a debt. `price × quantity` was refused in six of eight shops,
because the demo world also seeds an automatic 10%-over-500 promotion and the
till applies it. Pricing is server-authoritative by design, and the seeder is
not the server: it now asks `PromotionService::preview()`, the same thing the
POS asks.

### Realism that breaks the product is not realism

Eleven lots were first seeded already expired, "so the dashboard has a
near-expiry count". `InventoryService` fences expired quantity out of what may
be sold, and for a product whose only lot has expired that is **all** of its
stock — eleven demo products that silently refused to sell.

Exactly one lot is past its date now, and it is written off in the same pass,
so the disposals screen shows a true `expired` row and nothing is left blocking
a till.

## The guard

`DemoWorldIsCompleteTest` already existed, and its docblock already made the
right argument: *a seeder that silently stops covering the product is the same
failure as a screen that silently stops rendering it.*

It passed throughout. It enumerated features **by hand**, so it could only ever
cover what its author remembered in August.

It now carries a map:

```php
'dine_in' => [[DiningTable::class, []]],
'fuel'    => [[FuelTank::class, []], [FuelNozzle::class, []]],
```

For every non-demo tenant, every module that is ON must have rows in the tables
its screens read. Switch a module on for a demo shop and the test names the
table you have to fill.

With a denominator, because a count of findings is not evidence without a count
of attempts:

- ≥ 9 shops examined,
- ≥ 60 module/table pairs checked,
- and **every module in the map must be ON in at least one shop**, or nothing
  is testing it.

Proven by mutation twice. Removing `seedDineIn` fails with `Karahi House:
'dine_in' is on, but DiningTable is empty`; removing `seedForecourt` and
`seedStableDemoShop` together fails on ten pairs across two shops.

## What the guard then found in this work

The re-run test — extended from six tables to thirty-four, with its own
denominator that none of them may be empty — failed:

```
- 'ProductBatch' => 75,
+ 'ProductBatch' => 152,
```

`seedLots` guarded per-product with `whereDoesntHave('batches')`. That is a
fine filter and a useless guard: on the next run it simply picks the next eight
products *without* lots. Not duplication — growth — and the seeder's promise is
that a re-run changes nothing.

It is guarded on its own marker now (`batch_number like 'LOT-%'`), because the
obvious question — "does this shop have any lot?" — is already true on the first
run: the demo purchase order receives into dated lots of its own.

## Related

- [shopos-job-offered-must-be-doable.md](shopos-job-offered-must-be-doable.md) —
  the same failure one layer up: a job offered whose every screen is disabled.
- [shopos-detector-vs-rule.md](../memory/shopos-detector-vs-rule.md) — give every scanner
  a denominator.
- [shopos-workflow-test-rule.md](../memory/shopos-workflow-test-rule.md) — delete a step
  and it must fail.
