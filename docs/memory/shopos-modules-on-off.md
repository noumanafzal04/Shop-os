---
name: shopos-modules-on-off
description: "SHIPPED 2026-09-03: 9 new module keys so a shop gets only what it uses; kitchen split out of dine_in; one shared ModulePicker; tenant-side Your modules"
metadata:
  type: project
---

The ask (2026-09-02): a small takeaway café is shown disposals, bank offers and
a warehouse's worth of screens that link to nothing it does. Shipped 2026-09-03.

**The measurement that drove it:** the registry held **11 keys** and the menu
produced **53 screens**, so most screens arrived as PASSENGERS on a module
somebody else bought. `inventory` dragged in disposals/stocktake/labels/
suppliers/purchases; anything that could sell dragged in customers/coupons/
promotions/bank-offers; `pos` dragged in quotes.

**The sharpest case, and the one the user named: the kitchen pass lived inside
`feature:dine_in`** — a takeaway café had to switch on a whole restaurant
(tables, tabs, settle, split-bill, waiter reports) to get a slip to its kitchen.

**Shipped:** 9 keys — `purchasing`/`stocktake`/`disposals`/`labels` (→inventory),
`customers`, `promotions`, `bank_offers` (→promotions), `documents` (→pos),
`kitchen` (→products); `dine_in` now depends on `kitchen`.

**Rules worth keeping:**
- **Granularity is just more keys with `depends`.** No new mechanism —
  `normalize()` was not touched.
- Each key must land in **three places at once**: registry + route middleware +
  nav. Two of three is the `MODULE_DISABLED` bug class — see
  [[shopos-job-offered-must-be-doable]].
- **Down is the server's rule, up is the admin's.** normalize only switches OFF;
  the picker pulls a chain UP on a press and names what else moved.
- **`featureEnabled` walks the chain now.** `features` is a JSON column and a
  seeder can write an impossible map.
- **The migration's promise has its own test** that RUNS it over an old-shaped
  map: no live shop loses a screen.
- Only the EXTRAS default off. `customers` and `purchasing` are not extras;
  `bank_offers` is off for every trade.

**Also:** one shared `ModulePicker` (create + detail were two drifted copies),
and a tenant-side read-only `Settings → Your modules` (`GET /shop/modules`) —
because "why can I not see Purchases" had nowhere to look.

**STILL OPEN (P2): a takeaway sale does not reach the kitchen board.** KOTs come
only from a dine-in tab's Fire, so `kitchen` alone is a pass with nothing on it.
The till's Takeaway/Dine-in toggle now follows the MODULE (it read
`businessType === "food"`), which makes the gap more visible.

Related: [[shopos-images-and-riders]], [[shopos-plans-and-flow]] (a plan is
payment only), [[shopos-guards-share-a-blind-spot]] (four nav test files each
held their own copy of the trade map — now one `src/test/tradeFeatures.ts`).
