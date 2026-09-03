---
name: shopos-counter-order-kitchen
description: "SHIPPED 2026-09-03 (P2): a takeaway sale rung at the till now builds a counter order and fires its KOT; before this the kitchen was told nothing"
metadata:
  type: project
---

A KOT could only ever be created by a **dine-in tab's Fire**. So a café ringing
a takeaway at the counter printed a receipt and **told the kitchen nothing** —
the only way to get a slip to the pass was to run every order as a tab on a
table that does not exist. [[shopos-modules-on-off]] made this visible (a shop
can now have `kitchen` without `dine_in`) rather than causing it.

**Shipped:** `SendCounterOrderToKitchen`, called from `CreateSaleAction` inside
the sale transaction. Builds a restaurant ticket from the sale's food lines and
fires it.

**Rules worth remembering:**
- **A ticket, not a second shape.** The board, the bump lifecycle, the KOT print
  and `KitchenTicket::forAnOpenTab` are all built on a ticket. A parallel shape
  would need every one rewritten and the two would drift.
- **Only what a kitchen makes**, from the sale LINE's own `item_type` (the sale
  snapshots it) — not from the product, because a dish deleted an hour later
  must still reach the pan it was ordered for. **No food lines ⇒ no ticket at
  all**, which stops a mart from growing a floor.
- **`restaurant_tickets.sale_id` = the kitchen's work, not the floor's.** Paid
  before the kitchen sees it, so the floor list filters it out — otherwise every
  takeaway piles up as a table nobody sits at.
- **It stays OPEN until served.** `forAnOpenTab` means closing it at the till
  would drop the docket the instant it was fired. Only the last docket being
  served closes it — see `KitchenController::closeACounterOrderThatIsDone`.
- **A practice sale never reaches a real kitchen.**
- **The board headline is the CUSTOMER'S name** for a takeaway, not the word
  "Takeaway" on twelve identical cards. A cook has to have something to shout.

Related: [[shopos-food-dinein]], [[shopos-docket-outlived-tab]] (why
`forAnOpenTab` exists), [[shopos-training-mode]].
