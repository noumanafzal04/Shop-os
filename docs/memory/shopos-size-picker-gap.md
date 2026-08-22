---
name: shopos-size-picker-gap
description: SHIPPED 2026-08-22 — size picker on till (chips in tiles, sheet in rows) + dine-in; the real find was that varianted tracked products were UNSELLABLE (tile disabled on the orphaned parent stock). Variants still cannot be EDITED after creation
metadata:
  type: project
---

**Built 2026-08-22.** Tap an item, get asked which size, pay that size's price —
on the till and on the dine-in tab. See
`docs/decisions/shopos-a-size-nobody-could-tap.md`.

## The bug underneath the feature

`Product::effectiveStock()` says the parent `stock_quantity` of a varianted
product is "an orphaned leftover that must not be read as truth". The till's
`shownStock` read exactly that, and the tile is `disabled` on the result — so a
T-shirt with a full rail of S/M/L rendered **"Out of stock" and unpressable.**
Not cosmetic: the shop could not sell the item at all, online or off.

Fixed in three places so both repos agree: `PosProjection` sums the variants'
branch rows, `/products` stamps `branch_stock` per variant (additive, the
shop-wide rollup untouched), and the panel's stock helpers key deltas by
`(productId, variantId)`.

## Everything except the question was already built

Server pricing from `variant->price` (proven by SalesTest), dine-in complete end
to end incl. "Half"/"Large" on the KOT and KDS with its own test, offline mirror
pricing and refusing correctly, `addLine(p, variantId, name, price)`. The only
missing branch was the tap handler — so the **barcode scanner was the only path
in the product that could produce a variant line.**

## The rule, and where it lives

`src/modules/pos/availability.ts` — `sizesOf` / `catalogSizeStock` /
`catalogStock` / `whyNotSellable`. Six doors ask it: tile, row, chip, quick key,
scanner, dine-in tab. **I wrote it twice myself first** (PosPage + TabPage, 20
minutes apart) — the same way the 86 rule and the discount ceiling came to
disagree between those exact two screens. Caller supplies the stock reader (the
till subtracts its offline queue; a tab has none).

## UI shape

- **Tiles** → chips ON the tile, one tap = the add. Chips are SIBLINGS of the
  tile, not inside it: the tile is a `<button>` and nesting one is invalid HTML.
  Bonus: they land in the tab order.
- **Rows** → a sheet (shared `Modal`, so it gets a name + focus).
- **Dine-in** → tiles only; `h-24` became `min-h-24` (it was the one grid that
  could not absorb a chip row).
- A sold-out size is **shown struck through**, never hidden.

## STILL NOT POSSIBLE — read before promising a shop anything

- ~~A variant cannot be edited~~ **BUILT 2026-08-23.**
  `SyncProductVariantsAction` + rules on `UpdateProductRequest` + four lines in
  `UpdateProductAction`. Three musts, each mutation-proven: it **touches the
  parent** (the offline delta is on `products.updated_at`, so without it a
  retired size keeps selling offline and those sales die non-retryably on sync);
  it **never force-deletes** (5 cascades incl. `stock_movements`, 3 columns with
  no FK); it **refuses to leave a product with no sellable size**.
  `PUT /products/{id}` used to answer 200 and discard every variant.
- The **add UI** is a two-axis grid now — see [[shopos-button-submit-default]] for
  why it had never worked at all.
- A single size cannot be 86'd (`sold_out_at` is on products only).
- Recipes have no size dimension — half and full plate consume the same
  ingredients.
- A variant change never moves `products.updated_at`, so delta sync could not
  carry it to a till even once editing exists.

Related: [[shopos-pos-view-toggle]], [[shopos-sold-out-three-paths]],
[[shopos-promise-in-another-file]], [[shopos-food-dinein]].
