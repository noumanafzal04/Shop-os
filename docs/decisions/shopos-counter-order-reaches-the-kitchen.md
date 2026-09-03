# A counter order reaches the kitchen

**2026-09-03** · POS → kitchen · `SendCounterOrderToKitchen`, `CreateSaleAction`, `KitchenController`

## What was missing

A kitchen ticket could only ever be created by a **dine-in tab's Fire**. So a
café that rings a takeaway order at the till — the ordinary case, and what a
small café does all day — printed a receipt for the customer and **told the
kitchen nothing**. The only way to get a slip to the pass was to run every order
as a tab on a table that does not exist.

Splitting `kitchen` out of `dine_in` (see `shopos-only-what-a-shop-uses.md`) made
this visible rather than causing it: a shop can now have the pass without the
floor, and a pass nothing reaches is a screen with nothing on it.

## What changed

A takeaway sale rung at the counter now builds a **counter order** — a
restaurant ticket carrying the sale's food lines — and fires its KOT, inside the
same transaction as the sale.

## Why it is a ticket and not a second shape

Everything the kitchen does is already built on a ticket: the board reads KOTs
through theirs, the bump lifecycle stamps its items, the KOT print renders from
it, and `KitchenTicket::forAnOpenTab` is what stops a docket outliving the order
it belongs to. A parallel "food a till sold" shape would need every one of those
written again, and the two would disagree the first time either changed.

## The four rules

**Only what a kitchen makes.** Lines are filtered on the sale line's own
`item_type` — a bottle off the chiller is not work for the pass, and a board full
of things nobody cooks is a board the kitchen stops reading. **A sale with none
of them creates no ticket at all**, which is what stops a mart that switched the
module on from quietly growing a floor.

**Read the PRODUCT, and mind the trap.** `sale_items.item_type` looks like the
answer and is not: it stores the coarse `products.type` — product or service —
while the fine classification the menu is built on (`food_item`,
`physical_product`, `medicine`…) lives on the product. Filtering on the line
matched nothing and the kitchen was told nothing, which is exactly the failure
this change exists to end. The lookup uses `withTrashed()`, because a dish
deleted from the menu an hour after it was ordered must still reach the pan it
was ordered for.

**It is the kitchen's work, not the floor's.** A counter order is paid before the
kitchen has seen it, so it is not a tab anybody can add to or settle. The floor
list filters it out — without that, every takeaway a café sold would pile up on
the floor screen as a table nobody is sitting at.

It is marked by a new `restaurant_tickets.from_counter`, and NOT by the
`sale_id` already on that table. That column exists and already means something
precise — *the tab was settled as a single sale*. A counter order fills it
honestly too, because it IS settled by exactly one sale — but "settled by one
sale" and "was never a tab in the first place" are two different facts, and
filtering the floor on `sale_id` would have hidden every settled tab from the
closed-tabs view as well. One column answering two questions is the bug class
this codebase keeps finding; the first draft of this change had it, and the
schema caught it on the first run.

**It stays OPEN until it is served.** A tab closes when it is settled; this has
no settlement left to make, and closing it at the till would drop the docket off
the board the instant it was fired. So the last docket being served is the only
moment that can close it — and if nothing did, every takeaway a café ever sold
would sit open for ever and the kitchen's own backlog figure would climb by one
per order.

## Inside the transaction, on purpose

The docket is built from rows written a moment earlier, so the only realistic
failure is a bug — in which case losing an unrung sale is the loud answer, rather
than a paid order the kitchen never saw. A practice sale never reaches a real
kitchen: nothing in a training drawer is real, and a cook handed a practice order
cooks real food for nobody.

## What a cook calls out

The board's headline used to be the word **"Takeaway"** for every takeaway card,
which on a café's pass is a wall of twelve identical tickets and nothing to
shout. It is the **customer's name** now where the cashier typed one, with the
word as the fallback — and the card says `· Takeaway` underneath, because a cook
plating a dine-in dish and a cook bagging a takeaway are doing two different
jobs.

## Proven

`CounterOrderReachesTheKitchenTest` — the order arrives on the pass, only the
food is on it, a sale with nothing to cook makes no ticket, a dine-in sale does
not fire twice, a shop without the module gets none, the order never reaches the
floor, it stays open until served and closes when it is, a practice sale is
ignored, and one shop's order never reaches another's kitchen.
