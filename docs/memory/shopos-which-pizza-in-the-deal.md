---
name: shopos-which-pizza-in-the-deal
description: FIXED — a deal containing a sized product could not be sold AT ALL ("only 0 in stock" on a full shelf); combo_items gained variant_id and 4 stock writers now name the size
metadata:
  type: project
---

Probed before designing anything, on a shop holding ten Small and ten Large:

```
PARENT stock: 0 · effective: 20
SALE → 422  "Insufficient stock: only 0 in stock."
```

**Not a wrong number — a REFUSAL, on a full shelf**, quoting a figure the shop
could see was false. Any deal containing a sized product was unsellable.

The deduction ran against `products.stock_quantity`, which for a varianted
product is an orphaned leftover — the same figure that had disabled the POS tile
for sized items days earlier, one layer up. See [[shopos-size-picker-gap]].

**Three places, three different answers:**

- **schema** — `combo_items` had no `variant_id`;
- **save** — a deal naming no size could be created and then never sold. It is
  refused now, where somebody is looking at the deal, rather than discovered at
  the counter as "no stock". Same principle as [[shopos-job-offered-must-be-doable]];
- **sale** — FOUR sites move stock for a combo: `CreateSaleAction` (POS),
  `OrderService` (online), `ProcessSaleReturnAction` (refund) and the BOM
  snapshot. All four passed `product_id` alone.

**`distinct` had to come off the component id.** With sizes, "two Small and one
Large" is an ordinary deal — the pair `(product, size)` is what must be unique,
which a validation rule cannot express, so the check lives in the action.

On the screen the size dropdown appears only where the item HAS sizes, and
changing the product clears it — a Large pizza's id means nothing once the row is
a bottle of cola.

The e2e also drove out a duplicate label: the section's "+ Add item" and the page
header's "+ Add Item" (which opens the same drawer) differed by one capital
letter. Now "+ Add item to deal" — pointing the test at the case would have
written the confusion into the suite.
