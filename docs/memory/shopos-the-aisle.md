---
name: shopos-the-aisle
description: SHIPPED 2026-08-26 — marketplace rebuilt from a shop directory into a product aisle (browse/product/cart/checkout); multi-shop basket, facet-counted filters; and the suite now runs on BOTH SQLite and MySQL because each engine hid the other's bugs
metadata:
  type: project
---

**A customer does not shop for a shop.** `/shops` was a directory of shop cards
with a 744-line page behind each carrying its own header, cart, checkout and
modifier dialog. The backend could only answer "what does this shop sell".

Now: `/browse` (all products, all shops, filter rail), `/p/:id`, `/cart`,
`/checkout`, `/saved`, rebuilt `/shops`, all inside `MarketLayout` (one header,
one basket sheet, one footer).

**Three rules that must not be undone:**

1. **The basket spans shops; an ORDER does not.** Checkout places one order per
   shop, sequentially, each with its own idempotency key, and clears each shop
   from the basket the moment its order is real — so a half-succeeded checkout
   cannot end in two deliveries. The split is SHOWN on every screen, never
   discovered at the end. `cartStore` is `version: 2` with a migration.
2. **The rail is counted, never written down.** `/marketplace/products/facets`
   counts every option from the SAME builder the listing uses (`browseQuery`
   with `$except` so an axis does not count itself). A count that turns out
   wrong is worse than no count.
3. **A card may add what it can fully specify.** Sizes on the card; modifier
   groups go to the product page. And sizes must be on the card because "out
   of stock" is almost never true of a product — it is true of the Large.

**STANDING, the big one: the tests run on an engine the product does not use.**
SQLite and MySQL lie in OPPOSITE directions and each hides the other:

- `selectRaw` APPENDS → aggregate beside `products.*` → MySQL refuses under
  ONLY_FULL_GROUP_BY, SQLite allows. 19 green tests, 500 on the first real call.
- A PHP float binds as PARAM_**STR**, and SQLite orders every number BELOW every
  string → `2400 <= '500'` is TRUE → "under Rs 500" returned everything. MySQL
  coerces and hides it. Fix: `CAST(? AS DECIMAL(14,2))`.

CI now has `gate` (SQLite) **and** `gate-mysql`, and the deploy needs both. The
MySQL job asserts ONLY_FULL_GROUP_BY is on before running — otherwise it proves
nothing. That second run immediately found two pre-existing bugs: a **pharmacy
recall that could not find who took the bad lot home** (JSON pre-filter used
the typed casing; the on-hand query already lowercased, so the screen looked
like it worked), and a query-count test grepping `from "products"` — SQLite's
quoting — which counted zero on MySQL.

**e2e:** `market.spec.ts` runs in a `storefront` project with **no
storageState** — every other project signs in, and the marketplace's reader has
no account. Both filter rails are in the DOM at once (the `aside` is hidden by
CSS below `lg`, not unmounted), so locators there must be `:visible`.

See [[shopos-detector-vs-rule]], [[shopos-screen-testing]],
[[shopos-measurement-that-lied]]. Full write-up:
`docs/decisions/shopos-the-aisle.md`.
