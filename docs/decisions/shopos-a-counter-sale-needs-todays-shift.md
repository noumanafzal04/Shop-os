# A counter sale needs today's shift; a drawer is not closed uncounted; a report's days add up

Date: 2026-10-15. Bugs: L4 (reported by the user), L5 and L6 (found while checking it), L2 (a cash advance with no shift).
Code: backend `offline/v1/backend`, panel `offline/v1/admin-panel` (see the commit that names these bugs).

## Why

The user: "agar settings main open shift required hain to POS main bagair open shift ke sell q ho rahi?"
Zari Clothing has "Require open shift" on. Sana, Bilal and Hina had each opened a shift on 13 Oct and never
closed it. The till took the open row as "a shift" and rang the 14th's and 15th's sales into the 13th's drawer
and the 13th's trading day. And four other screens that take money at the counter — settling a tab, New Sale,
an exchange, billing a quotation — never read the setting at all; only the till's own sale route did.

## The rule

With `pos_require_shift` on, every COUNTER sale (channel `pos` or `walk_in`) needs the seller's own shift,
open, and opened on TODAY's trading day (`ShopDay`). One place: `BooksDrawer::mustBeOpenToday`, called from
`CreateSaleAction`, so every route that rings a counter sale gets it — till, tab settle, New Sale, exchange,
quotation/layaway billed. Refusals are 409:

- `SHIFT_REQUIRED` — "Open a shift before ringing up a sale."
- `SHIFT_FROM_AN_EARLIER_DAY` — "This shift has been open since 13 Oct 2026 — close it and open today's …"

Not refused: a phone or online order (not a counter sale), an offline sale replayed from the outbox (it was
rung under the rules of its own moment — the trusted path), and any shop with the setting off.

The old check in `SaleController::store` was removed; it covered one route of five.

## On the screen

- `/pos/session` now says `opened_on` and `from_an_earlier_day`.
- The till: a strip across the top. Red when the till will not ring ("Open a shift to sell — this shop
  requires one." / "Your shift has been open since 13 Oct 2026 — close it and open today's to sell.") with the
  button that fixes it (Open shift / Close shift). Amber when the shop does not require shifts but the drawer
  is an earlier day's — a reminder, selling still allowed. The strip waits until the till KNOWS which shift is
  open: drawn while still loading, it said "Open a shift" over a drawer that was open since the 13th.
- The reason is said once: the small print under Tender / Pay is left out while the strip shows (a long reason
  there also squeezed the grand total to "Rs 4,…"; it is now never wider than the button).
- Tab settle, New Sale (walk-in / till channel only), exchange, Bill & hand over: the same sentence and a link
  to the till; the button that takes the money is shut. `useCounterShift` + `ShiftNeeded`.

## Cash taken as an advance, too (L2)

Cash taken on a layaway or a job card goes into the taker's drawer (`deposit_in`). With no shift it was
recorded and reached no drawer, silently. The same rule now holds it, in `RecordDepositAction` (the opening
advance when goods are held, and every instalment after): a shop that requires shifts refuses CASH without
today's shift — "Open a shift before taking cash." (`mustBeOpenToday(..., $doing)` names what was refused).
Card, bank, wallet and other money needs no drawer and is never held up. Both forms that take an advance — the
till's / Quotations screen's "Save this ticket" and an advance's "Take instalment" — say so on cash and shut
their button (`useCashNeedsShift`). A shop that does not require shifts is unchanged: like a sale, the cash
belongs to no shift, and the help says so.

## A drawer is not closed uncounted (L5)

Walking the fix, two presses — "Close shift" on the strip, then on the sheet — closed Sana's 13 Oct drawer,
which should have held 22,580, as counted at 0: the whole drawer booked short. Now the sheet's button stays
shut until a note count or a total is entered (a typed 0 is a count). An empty drawer is said out loud with its
own tick, "The drawer is empty", which then books whatever the drawer should hold as short, on purpose.

## A report's days add up to its total (L6)

`/reports/summary` printed `totals.gross_profit` 347.31 for 14 Oct and `series[0].profit` 1,980 — the revenue.
The bucket's profit was "cash-shaped" by design (revenue + other income − expenses): no cost of goods, no tax,
no refunds. The panel's Reports chart does not draw it (it draws revenue and expenses), but the field was
wrong for anyone who read it. Each bucket now carries `refunds`, `tax` and `cogs` and its `profit` is the
headline's net profit for that bucket — refunds, their tax and the returned goods' cost filed by the return's
moment, the rest by the sale's — so the buckets add up to `totals.net_profit`, and each day equals the
dashboard's day (`OneNightIsOneDayTest`).

## Proof

- `AShopThatAsksForShiftsSellsOnTodaysShiftTest` (3 tests; 4 mutations caught): every counter way refused
  without a shift and on an earlier day's shift; a phone order not refused; close + open → the sale goes
  through; a shop without the setting not refused.
- `requireShift.test.ts` +3; `CloseShiftModal.test.tsx` (4 tests; 5 mutations caught).
- `OneNightIsOneDayTest` + 5 checks on Reports (4 mutations caught).
- The advance: `AShopThatAsksForShiftsSellsOnTodaysShiftTest::test_cash_taken_as_an_advance_needs_todays_shift`
  (4 mutations caught — one survived until a closed-plus-open shift case was added); `useCounterShift.test.ts`
  (4 tests; 4 mutations caught). Walked: `p6-advance-shift.mjs` — Hina, no shift: cash → the note and a shut
  button on both forms; Card → no note, button on. Nothing saved.
- Walked on the copy stack (`panel/e2e/qa-kit/p6-shift.mjs`, `p6-shift-close.mjs`): Zari, Sana's 13 Oct shift —
  red strip with "since 13 Oct 2026", Pay shut; New Sale, exchange, Bill & hand over each show the note and a
  shut button; Close → Open (float 5,000) → INV-000016 (4,990 cash) on the new shift; the drawer then expects
  9,990. Hina's 13 Oct shift: Close shut until counted, Expected 400, counted 400, variance 0.

## Left as it is

Sana's 13 Oct shift was closed by the first walk with nothing counted (variance −22,580) — before L5 was
fixed, and exactly the fault L5 is. It is QA data in Zari Clothing; there is no recount route.
Bilal's 13 Oct shift is still open, so the red strip can be seen.
