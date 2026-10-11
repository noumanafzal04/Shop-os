# A size is said everywhere — and what a return is worth is said first

**2026-10-11.** Found by living a clothing shop's day (journey stage T) and a
café's (stage U). Not pushed.

## A clothing shop could not exchange a size

The exchange sheet was a seventh door into a cart, and the only one that did
not ask the till's question. It listed products, took the product's price and
sent the product's id. For anything sold in sizes the server answers
`VARIANT_REQUIRED` — "say which size this is for" — and the sheet had nowhere
to say it. The server had accepted `items.*.variant_id` all along: a reader
with no writer, again.

- `panel/src/modules/sales/replacements.ts` — what a searched product OFFERS
  (itself, or each of its sizes and never the design alone), with the till's
  own reason when it cannot go (`whyNotSellable`) and how many are left.
  Two sizes of one design are two rows. `linesOut` sends the size.
- The names a line is known by — the refund box, the hand-back box — carry
  the size. Two boxes for one design were announced identically.

## The money is the server's sum, asked before the press

The exchange sheet added up tag against tag, with no tax, and called both
figures "(est.)". A Medium bought for 2,625 going back for a Large at 2,835
was "collect 200"; the sale wanted 210 and refused the exchange. The refund
sheet named no figure at all until after the money had moved.

- `ProcessSaleReturnAction::worth()` — the refund arithmetic, moved out of
  `execute()` unchanged (the diff is the proof) so there is ONE sum.
  `execute()` pays out what it says.
- `POST /sales/{sale}/returns/worth` — reads only, `sales.refund`. Refuses
  what the return would refuse (more than is left, a cancelled sale).
- The refund sheet: "Goes back to the customer Rs 2,835 · incl. Rs 135 tax".
- The exchange sheet: the credit is that figure; what goes out is
  `tillBill()` — the till's own bill, held to the server by fixtures. Complete
  is not offered until the credit is known.

`useReturnWorth` is deliberately NOT keyed under `"sales"`: a return that goes
through invalidates everything under that key at once, and the query asked
again for the lines that had just gone back ("only 0 left to return") while
the sheet was closing. The journey's watch caught it.

## Sizes keep the order they were typed in

`Product::variants()` was `orderBy('name')`. A kurta carded S, M, L read
L, M, S on the till's "which size?" sheet, the edit grid, the labels and the
stock screen; Half and Full read Full, Half.

- `product_variants.sort_order` (migration `2026_10_11_000003`), written by
  the two writers of sizes and the demo seeder; the relation orders by it and
  then by name, so anything given no place reads as it did. Existing products
  that kept their grid (`attributes.variant_axes`) are put back in its order.
- **The trap:** the validator rebuilds each row rule by rule and `id` is the
  first rule, so a row with no id — every NEW size — is handed over after the
  rows that had one. Both writers `ksort` before they count positions.

## "For here", at a counter with no floor

A food shop without the Dine-in module is offered Dine-in at the TILL, with a
table number to type. `SendCounterOrderToKitchen` returned early unless the
order was a takeaway — a rule written to keep a settled TAB from being fired
twice — so a cup paid for "for here" never reached the pass. A test asserted
the empty board.

- Whether a sale settles a tab is a fact about where it came from:
  `SettleTicketAction` says `settles_tab`, `CreateSaleAction` skips the
  kitchen for exactly that, and no request rule knows the key.
- A counter order goes to the pass whether it was rung to take away or for
  here. `RestaurantTicket::goesTo()` is the one answer to "where is it
  carried": the table's name for a tab, the number typed on the sale for a
  counter order ("5" → "Table 5"; "Garden" stays "Garden"), nothing for a
  takeaway. The board and the printed slip both read it.
- **The trap:** inside a model, `$this->table` is the database table's name.
  `getRelationValue('table')`.

## Small things on the same walk

- A cash note too small for the bill read "Change due Rs 0" over a dead
  button. It reads "Still to pay Rs 182.50" (`shortBy`, in `tillBill.ts`).
- A required question on a dish opens ON its first answer at the till (regular
  milk) and must be answered by hand on a table's tab. Left as it is — a
  counter is quicker for it — and written down here because it is a
  difference somebody will notice.

## Tests

`WhatAReturnIsWorthTest` (8), `SizesKeepTheOrderTheyWereTypedInTest` (3),
`CounterOrderReachesTheKitchenTest` (+4, one rewritten),
`replacements.test.ts` (14), `tillBill.test.ts` (+4); journey stages T and U,
nine cases each.
