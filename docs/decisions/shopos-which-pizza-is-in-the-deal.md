# Which pizza is in the Family Deal

**2026-08-24 · backend + panel**

## Measured before it was designed

A deal listed its components by PRODUCT, and a product can have sizes. So a deal
containing a pizza never said which pizza. A probe on a shop holding ten Small
and ten Large:

```
PARENT stock: 0 · effective: 20
SALE → 422  "Insufficient stock: only 0 in stock."
```

**Not a wrong number — a refusal, on a full shelf.** Any deal containing a sized
product was unsellable, and the message named a figure the shop could see was
false.

The deduction ran against `products.stock_quantity`, which for a varianted
product is an orphaned leftover that must not be read as truth — the same
figure that had already disabled the POS tile for sized items a few days
earlier, one layer up.

## The gap was in three places, and each needed a different answer

| | |
|---|---|
| **schema** | `combo_items` had no `variant_id`, so the size could not be recorded at all |
| **save** | a deal that names no size could be created — and then never sold |
| **sale** | four sites moved stock for a combo, all against the parent |

## A deal nobody can sell should not be saveable

"Which pizza is in this deal" is a question only the shop can answer. Guessing at
sale time would mis-count a real shelf, so it is asked once, **where somebody is
looking at the deal**:

> Choose which Pizza this deal contains — it comes in sizes.

Rather than at the counter, in the form of "no stock" on a shop that has plenty.
Same principle as the job presets: an offer that cannot be fulfilled should not
be made.

## A restriction that had to go

`combo_items.*.component_product_id` carried `distinct`. With sizes, **"two Small
and one Large" is an ordinary deal** and the same product appears twice — so the
pair `(product, size)` is what has to be unique, which a validation rule cannot
express. The check moved into the action; typing the same item AND size twice is
still refused, because the second line would silently replace the first in
anybody's reading of it.

## Four writers

`CreateSaleAction` (POS), `OrderService` (online), `ProcessSaleReturnAction`
(refund) and the BOM snapshot all consume a deal's components. Every one of them
passed `product_id` alone. All four name the size now — including the snapshot,
which is what a sale records about what it consumed, so a refund reads the same
shelf the sale took from.

## On the screen

The size dropdown appears **only where the chosen item has sizes**, and changing
the product clears it: a Large pizza's id means nothing once the row is a bottle
of cola, and the server would rightly refuse it as "not one of Cola's".

The e2e drove out a second, smaller thing. The section's button read **"+ Add
item"** while the page header carries **"+ Add Item"** that opens the very same
drawer — two buttons a screen apart saying the same three words, told apart only
by a capital I. A person reading has the section heading for context; a screen
reader announcing a list of buttons does not. It says "+ Add item to deal" now.
Pointing the test at the letter case would have been easier and would have
written the confusion into the suite.
