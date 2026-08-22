---
name: shopos-size-picker-gap
description: REQUESTED, NOT BUILT — variants (S/M/L with own price+stock) fully exist in data and cart plumbing but NO screen can pick one; till and dine-in tab both send variant_id null. Modifier groups are today's workaround
metadata:
  type: project
---

**The ask (2026-08-21, keep-in-memory only — do NOT build until asked).** At the
till, especially for FOOD: tapping an item should ask **which size** — S / M / L /
XL or whatever the shop calls them — as tappable buttons, and take that size's own
price. Same on the **dine-in tab**, where a waiter takes a guest's order during the
day.

## What already exists (verified in code, 2026-08-21)

Everything except the picker:

- `ProductVariant` — its own `price`, `cost`, `stock_quantity`,
  `low_stock_threshold`, `is_active`; cost hidden via `HidesCostPrice`.
- **Per-business-type variant attributes** in `BusinessTypes` — a diner's are
  literally `Plate/Size`, a pharmacy's `Strip/Strength`. The intent was already
  designed in.
- `ProductFormPage` creates and edits variants (`FormVariant`/`VariantInput`).
- Variant-aware batches (`add_variant_to_product_batches`) — medicine FEFO.
- POS **cart plumbing is complete**: `addLine(p, variantId, variantName,
  variantPrice)`, the line renders as `"Product / Variant"`, and `variant_id` goes
  to `/preview` and to checkout.
- Dine-in wire format carries `variant_id` and `variant_name`.

## The gap — a 10th "built but unreachable"

`PosPage.tsx` line ~1330, the whole tap handler:

```ts
if (p.modifier_groups?.length) openConfig(p); else addLine(p);
```

No variant branch. Tapping a product ALWAYS adds it with `variant_id: null`. A
variant can only be reached by **barcode scan** (~1259) or the scale/pack path
(~1278). `TabPage.tsx::addProduct` is the same — checks `modifier_groups` only and
**never sends `variant_id`**, though the service type has the field.

So a shop can create Small/Medium/Large with separate prices and separate stock,
and no cashier or waiter can ever select one by tapping. Worse than the usual
instance of this class, because the product form **invites** it — the diner's own
variant attribute is "Size".

## Today's workaround, which genuinely works

A required single-select **modifier group**: "Size" with `min_select: 1`,
`max_select: 1`, options Small `price_delta 0`, Medium `+150`, Large `+300`. That
path IS wired at the till (`openConfig`) and on the dine-in tab, and already
renders as tappable option buttons — which is close to the UI being asked for.

## The design rule when this is built

**Variant or modifier depends on whether that size is its own STOCK.**

| | Variant | Modifier option |
|---|---|---|
| Own stock, cost, barcode | yes | no |
| Price | absolute | `price_delta` |
| Right for | T-shirt L, 1.5L bottle, strip vs box | a cooked dish's Large, extra cheese |

A cooked dish's Large is not separate inventory → modifier. A bottled 1.5L Pepsi
and a T-shirt in L both ARE → variant. So the till needs the variant picker
**as well as** the modifier sheet, not instead of it — and if a product has both,
the size question comes first, then the extras.

Build it in BOTH places or neither: [[shopos-sold-out-three-paths]] and
[[shopos-ceiling-follows-the-bill]] are the same shape — the till obeyed a rule
and the dine-in tab did not.

## The UI, as specified (2026-08-22)

**The shape follows the view, and the views already exist.** `posLayout` is
`"grid" | "list"`, a per-DEVICE preference ([[shopos-pos-view-toggle]]), and both
branches already render from the same `tiles` array — `PosPage` ~2132 for grid,
~2265 for list.

| view | size picker |
|---|---|
| **grid** (Tiles) | **inline on the tile** — size buttons on the card itself, one tap adds that size at that size's price. No dialog at all |
| **list** (Rows) | **popup** — a row is too narrow for chips, so tapping opens a sheet of size buttons |
| **dine-in tab** | tiles ONLY (`TabPage` ~326 is `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`, no toggle), so it takes the **inline** treatment |

**The defaults line up with the request by luck, and it is worth knowing.**
`tradeDefaultView` (PosPage ~268) is `grid` for a restaurant and `list` for
everyone else. So FOOD gets the inline-chips-on-tile experience by default —
which is exactly where this was asked for — and a retail counter gets the popup,
which is right for a shop that works by scanning and typing rather than looking
at pictures.

Design notes for when it is built:

- One tap, never two. On a tile the size button IS the add — do not make the
  cashier select a size and then press Add.
- The tile needs somewhere for 2–5 buttons without becoming taller than its
  neighbours. `lg:grid-cols-4` is already the settled tile count and the tile
  steps its own padding down at `lg` — the chip row has to live inside that, not
  stretch it.
- If a product has BOTH sizes and modifiers, size comes first, then the modifier
  sheet.
- A sold-out size must refuse like a sold-out product does
  ([[shopos-sold-out-three-paths]]) — per variant, since a variant has its own
  `stock_quantity`.
- Whatever is built has to be driven in a real browser at all four viewports; a
  chip row on a 390pt phone is the case that will break
  ([[shopos-screen-testing]], [[shopos-cart-hid-its-lines]]).

Related: [[shopos-food-dinein]], [[shopos-the-customer]] (dish modifiers),
[[shopos-reachability-rule]], [[shopos-business-priority]].
