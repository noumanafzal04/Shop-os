# A screen that takes money asks what it will take

**2026-10-12.** The owner, after the first of these was found:

> "to ye calculation hr jgah again check honi chahye — is tarhan to hmare
> system main or b bug ho skty … ye logics main hain jo tum ignore kr rhy."

Built and tested; **not pushed** until they say.

## Two screens that could not take their own figure

| screen | it said | the till said |
|---|---|---|
| a tab's **Settle** sheet — 2 karahi, 3 teas (tea at its own 18%) | "Take Rs 4,485" | "Amount paid (4,485.00) is less than the total (4,611.90)." |
| **New sale** (an invoice written by hand) — one item at 4,200 + 18% | "Complete Sale · Rs 4,200" | "Amount paid (4,200.00) is less than the total (4,956.00)." |

The Settle sheet multiplied the chosen lines by the shop's *default* tax rate
(its comment called an over-estimate "safe"; an under-estimate is a refusal).
New sale multiplied price by quantity and had no tax in it at all, and showed
change that was wrong by the tax. Neither could be completed by paying the
amount on its own button.

## Why the tests were green

Every backend test that settled a tab paid **999,999**. The browser test of the
tab paid through the API, with the server's own figure. The screen's button,
with the screen's figure, was never pressed. *A test that pays more than the
bill proves nothing about the bill.*

## The decision: the sale path can be asked

There is one place that knows what a sale comes to — `CreateSaleAction`, with
its tax per line, a member's discount, a coupon, a tip, the coin a cash bill
settles to. A second copy of that sum is what drifted, twice. So nothing is
copied:

- `CreateSaleAction` runs as it would to ring the sale and, **at the first line
  the bill is known and before anything is written**, throws
  `App\Exceptions\SaleQuoted` carrying the figures — if it was only being asked
  (`quote_only`, a switch set by our own code and in no request's rules).
- `CreateSaleAction::worth($sale)` and `SettleTicketAction::worth($ticket, …)`
  call the real path and catch it. The transaction rolls back: a tab line
  carved in two for a split is whole again, a one-use coupon is unspent, no
  invoice number is taken.
- `POST /sales/worth` (the sale's own request rules and permissions) and
  `POST /restaurant/tickets/{ticket}/settle/worth` (`splits`, `methods`,
  `tip_amount`) answer `{subtotal, discount, tax, total, tip, rounding, due}`
  (+ `payable` for a sale).
- The screens show those figures and no others — nothing while they are being
  asked for — and send back exactly `due`. New sale also sends
  `expected_payable`, so a price that moved between asking and ringing is
  refused in words (`BILL_MISMATCH`) rather than charged.

What a question does **not** tell you: stock. A shelf too short is found when
the stock is moved, which is after the sale path stops; it is still said, by
the sale, when it is rung. (Stopping later would mean stopping after the
kitchen had been told.) A test holds that sentence in place.

## Tests

- `WhatATabWillAskForTest` (9) and `WhatASaleWillAskForTest` (11): **pay
  exactly `due`**, to the paisa — four tax rates on one table, part of a line,
  a discount, cash rounding vs card, a tip; asking writes nothing, takes no
  number, spends no coupon; a question with a sale's key is still a question;
  a question never rings a sale whatever it is handed; who may ask.
- Mutations on a **copy** of the backend (the owner was using the API): 8 of 8
  and 7 of 7 caught. The first run reported 0 of 8 — the copy's `vendor` was a
  symlink, so composer loaded every class from the real tree and no mutant ever
  ran; the copy now has its own `vendor/composer`, `autoload.php` and phpunit,
  and proves it by asking a class where it lives.
- Panel: `dinein/settleSheet.ts` (+9 tests) holds what the sheet asks and how a
  known amount is divided between two tenders; `e2e/new-sale-figure.spec.ts`
  pays the figure on the button; the tab case in `print-window.kitchen.spec.ts`
  reads 4,611.90 off the sheet and presses Take.

## Every screen that adds money up, and where it stands

| screen | adds up itself? | state |
|---|---|---|
| tab → Settle | did | **asks the server** |
| New sale | did | **asks the server** |
| the till | yes (it must, to work offline) | already held: it sends `expected_payable`, and a difference is refused with the real figure and shown as a correction |
| exchange / refund on a sale | no | asks the server (11 Oct) |
| Take an order | yes — "Approximately", with no delivery fee | **owed**, with that screen's rebuild |
| a tab's running total | yes — "+ tax at the bill", only when the shop has a default rate | owed (display; nothing is paid on it) |
| purchase order | yes — not rounded line by line as the server does | owed (display; a paisa at most) |
| customer checkout | yes, in a tested module; a coupon is said to come off later | to be walked in the full QA |
| quotation / invoice, job card, day close, rider cash | no — the server's figures | — |

## Files

Backend: `app/Exceptions/SaleQuoted.php`, `CreateSaleAction` (`worth`, the
stop), `SettleTicketAction::worth`, `SaleController::worth`,
`RestaurantTicketController::settleWorth`, two routes. Panel:
`dinein/settleSheet.ts`, `useSettleWorth`, `TabPage`; `useSaleWorth`,
`salesService.worth`, `NewSalePage`.

## 2026-10-12 (later) — the third screen: Take order

The Take-order page printed "Approximately" over its own sum of the lines. It
asks now (`POST /orders/worth`, `OrderQuoted`) — see
`shopos-an-order-reaches-the-kitchen.md`. Still adding up for themselves, and
still owed a look: the tab's footer total, a purchase order's per-line
rounding, and the customer's own checkout.
