# An item is counted, or it is not — and a shop can change its mind

**2026-10-12.** Found by walking a restaurant from an empty shop (the owner's
ask: *"aik complete flow bnao jis main hr page, hr module, hr modal sb kuch
test ho… kisi aik business type ko leke"*). On the fourth step — an order at a
table — the first dish the restaurant had carded read **"none left"** and
could not be pressed. Built and tested; **not pushed** until they say.

## What was wrong — two faults, one on top of the other

**1. The first dish was born counted.** The item form's "Track stock for this
item" started as ON, and an effect put it right when the list of item types
arrived from the server (a dish is made to order: OFF). A dish created *before*
they arrived was sent as counted, at a stock of zero. That is the first dish of
a new shop — nothing is cached yet — on a slow line, or simply typed quickly.
Proved by delaying `/item-types` six seconds: `track_inventory: true`,
`stock_quantity: 0`, every time. While it waited the form also showed the kind
of item by its code (`food_item`).

**2. The switch could not put it right.** On an item that exists, the same
switch flipped, the form saved, and the item was what it had been: the form
never sent `track_inventory` on an edit, and `UpdateProductRequest` prohibited
it. No screen and no endpoint could change it. So the dish was unsellable at a
table for good, unless somebody guessed to give it stock.

A third thing made it worth a whole rule and not a patch: a default that
depends on a request having arrived, with "unknown" falling to the dangerous
value, is the same shape as `An Absent Field Is A Branch`.

## The decision

**The form says nothing about counting until somebody has chosen, or it has
been told what the kind of item does.**
- `trackChoice: boolean | null` — `null` is "nobody has said". What nobody
  said is not sent; the server's own default for the item type stands
  (`CreateProductAction`, already right: a dish is not counted, a packet is).
- While its name is on the way, a kind of item is called `Food item`, not
  `food_item`.

**Counting can be changed after the item is made** — as on Shopify ("Track
quantity"), Square and Loyverse, where it is an ordinary switch.
`ChangeStockTrackingAction`, called by `UpdateProductAction`:

| Asked | Answer |
|---|---|
| start counting anything a shelf can hold | yes |
| start counting a service | no — `STOCK_NOT_COUNTED_FOR_TYPE` |
| stop counting | yes, unless something else is counting ON it: |
| …a unit sold by its serial number | no — `STOCK_COUNT_REQUIRED` |
| …an item with a dated lot still on the shelf | no — sell or write the lot off first |
| …an ingredient of a dish | no — says how many dishes; take it out of the recipes first |

Each refusal is a sentence that says what to do, and it undoes the **whole**
edit: the form is never half-saved behind an error.

**The number is not the switch's to change.** Stopping does not zero the shelf
and starting does not invent one — a stock figure moves through a movement
with a reason and a name on it. An item that stops being counted keeps its
last figure on record, out of the stock value; one that starts is counted from
what the books hold, and when that is nothing the shop is **told it is out of
stock** — in the form before Save is pressed (`data-testid="counting-change"`),
and again in the answer.

Not done: the change is not in the audit trail. `Product` audits prices only,
and that trail is also the price history; a counting change filed there would
read as a price change. Say if it should be recorded.

## Why the tests had not seen it

The food journey's first stage created its dishes and checked their name, price
and station — never that a dish was not counted — and on a quiet machine the
item types always arrived before a robot finished typing. It took a second
browser suite running beside it, slowing the server, to lose the race. Stage H2
now asserts `track_inventory === false`.

A second thing surfaced on the way: stages H6, J8 and J9 read the Settle
sheet's "Tax (5%)" row. The sheet stopped working a rate out for itself on the
same day (it shows the till's own figure, labelled "Tax"), and the food journey
had not been re-lived since. Corrected.

## Tested

- `backend/tests/Feature/AnItemIsCountedOrNotTest.php` — 10 cases: the dish put
  right and then sold; nothing said changes nothing; the figure is kept; the
  three refusals, each with its sentence and each leaving the rest of the edit
  unsaved; a service; and what is born when nothing is said.
- `panel/e2e/food.first-dish.spec.ts` — the race itself (item types delayed),
  the switch kept on an edit with its warning, and the refusal said on the form.
- `panel/e2e/journey/20-food-the-floor.spec.ts` H2 — a dish is not born counted.
