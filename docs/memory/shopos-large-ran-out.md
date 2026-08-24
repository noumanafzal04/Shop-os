---
name: shopos-large-ran-out
description: per-size 86 SHIPPED — a size is what runs out, not a product; one shared SoldOut rule for all 3 selling paths; size checked first; "trusted" deliberately not a parameter
metadata:
  type: project
---

Per-size sold-out (86) shipped 2026-08-24. Before it, eighty-sixing was a
decision about a PRODUCT: a pizzeria out of large bases had to take the whole
pizza off — Small and Medium with it, all evening, on the busiest menu item.

**Why:** a size is what a customer orders and what a kitchen runs out of, so a
size is what has to be markable. The product-level flag stays — "no pizza
tonight" is a real sentence, and not the same one as "no large".

**How to apply:**
- The rule lives ONCE in `App\Support\SoldOut::assertSellable(Product, ?ProductVariant)`.
  Three paths sell — `CreateSaleAction` (counter), `OrderService` (online),
  `AddTicketItemsAction` (dine-in tab). See [[shopos-sold-out-three-paths]]: the
  first time round, `ITEM_SOLD_OUT` lived on the counter alone and the other two
  sold it anyway. `scripts/one-rule-many-paths.py` watches all three.
- **The size is asked FIRST.** "No large, but we have medium" is a sale; "no
  pizza" when only the large ran out is a lost evening.
- `trusted` is deliberately NOT a parameter. A dine-in settle and an online
  capture are food already eaten — those paths simply don't call the rule, out
  loud, rather than passing a flag that hides the choice.
- Chef presses it on the same ROW button, which now asks *which* when there is a
  which (small sheet, one tap). Never in the product editor — a chef is not
  opening a thirty-field form twice a day.
- Mirror carries `sold_out: boolean`, till carries `sold_out_at: string|null`;
  `browse.ts` translates. **Absence reads as "on"** so an un-synced device sells
  rather than refuses. Compare [[shopos-member-discount-offline]].

Columns: `product_variants.sold_out_at` + `sold_out_by`. Tests:
`OneSizeSoldOutTest` (6). Doc: `docs/decisions/shopos-the-large-ran-out.md`.
