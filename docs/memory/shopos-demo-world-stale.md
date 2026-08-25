---
name: shopos-demo-world-stale
description: FIXED 2026-08-26 — the demo seeder ran fine for 2.5 weeks while covering none of the new product; two modules were ON with empty tables; the guard is now a module→table MAP with a denominator
metadata:
  type: project
---

**A seeder that still runs is not a seeder that still covers the product.**

On 2026-08-26 `DemoDataSeeder` exited 0 and printed nine shops, and had not
been edited since 9 August while ~15 features shipped past it. Judge it by a
per-tenant **census**, never by the exit code.

Two gaps were worse than thin — **a module switched ON with an empty table
underneath**, which reads as broken, not unconfigured:

- Karahi House had `dine_in` on and no tables → no tab could open, kitchen
  board permanently empty, and the till's free-text table is deliberately
  hidden for dine-in shops so dine-in was undemonstrable.
- Highway Fuel had `fuel` on and no tank → `OpenForecourtShiftAction` answers
  `NO_FORECOURT_CONFIGURED`. All of Unit 11 unreachable.
- **Demo Mart** (`owner@demomart.test`, the credentials in the seeder's own
  docblock) had every module on and zero content. `DemoTenantSeeder` makes the
  tenant; nothing filled it. `seedStableDemoShop()` now does.

`product_variants` was **0**: the seeder had a `variants` reader since the
first import and no catalog ever wrote one. Same for `modifiers`. Same for
barcodes — `products.barcode` null everywhere, so the till's scanner box had
nothing to find. See [[shopos-code-for-each-size]] — same shape, one layer out.

Three rules this cost, each of which cost a wrong turn first:

1. **Exit 0 + no warning ≠ success.** The equipment pass was called before the
   catalog existed, so every method found nothing and returned. Green run, 13
   tables, nothing else. Row counts told the truth. See
   [[shopos-measurement-that-lied]].
2. **The seeder must not compute a total.** A khata tender must equal the bill
   exactly; `price × qty` was refused in 6 of 8 shops because the demo world
   seeds an automatic 10%-over-500 promotion. Ask
   `PromotionService::preview()` — what the till asks.
3. **Realism that breaks the product is not realism.** 11 expired lots seeded
   "for the dashboard" made 11 products unsellable — `InventoryService` fences
   expired quantity out of what may be sold. Exactly one expired lot now, and
   it is written off in the same pass.

**The guard.** `DemoWorldIsCompleteTest` already existed with the right
argument in its docblock and passed throughout, because it enumerated features
**by hand** — it could only cover what its author remembered. It now carries a
`moduleNeeds()` **map** (module → the tables its screens read) plus a
denominator: ≥9 shops, ≥60 pairs, and every module in the map must be ON
somewhere. Mutation-proven twice. Switch a module on for a demo shop and the
test names the table you must fill. See [[shopos-detector-vs-rule]].

Its own re-run test (now 34 tables, none may be empty) then caught a bug in
this work: `seedLots` guarded per-product, so each re-seed gave lots to the
NEXT eight products — growth, not duplication. Guarded on its own marker
(`batch_number like 'LOT-%'`), because "has any lot" is already true from the
demo purchase order.

**Do not re-raise:** `seedSales`/`seedPurchases` say `doesntHave('variants')`
on purpose (they predate sizes). Adding variants does not make one get sold —
that is what `seedSizedSale` is for.

2270 tests / 9537 assertions, exit 0. Full write-up:
`docs/decisions/shopos-demo-world-catches-up.md`.
