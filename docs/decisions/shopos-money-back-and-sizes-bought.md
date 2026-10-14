# Money handed back, and sizes bought from a supplier

**Date:** 2026-10-13 night → 2026-10-14 · **Phase 1, part 1** of `docs/qa/SYSTEM-TEST.md`

Zari Clothing lived a second day by hand: returns, exchanges, khata, a supplier,
two purchase orders. Six things were wrong; all six are fixed here. A cloud
tester walked the same phase on a fresh stack the next morning (`docs/qa/BUGS.md`,
pass 1) and found the same five P1s independently, plus 25 more that are OPEN.

From here testing and fixing are split: a tester session only tests
(`docs/qa/TESTER-BRIEF.md`); this session fixes. `BUGS.md` is the one list.

## 1. Cash handed back that no drawer counts (B01, part)

**Was:** a manager with no shift of their own refunded 4,990 in cash. The notes
came out of a cashier's till; the refund belonged to no drawer; the cashier
closed short by exactly 4,990, and nobody was told.

**Now:** money handed back goes through the person's OWN open shift or through
none (the expenses' rule — never into a stranger's drawer). `returns/worth`
answers `drawer: open | practice | none | null` (`BooksDrawer::stateFor`); the
Return and Exchange sheets warn BEFORE the press when cash would move through
no drawer; the return's answer carries the same warning.

**Still to build (owner, 2026-10-14):** the refund leaves the cashier's own
drawer with a supervisor's PIN approval and an audit record. See `BUGS.md`.

**Test:** `CashHandedBackIsCountedSomewhereTest`.

## 2. Exchange for something cheaper (B02)

**Was:** always refused — "no cash was handed over, so there is no change to
give". The exchange pays the new sale with the credit as an "other" tender and
hands the difference back as change; the change rule only counted cash.

**Now:** the exchange credit counts as money handed over for change
(`exchange_credit`, server-only — not a field the request accepts). The
difference goes back as `change_due` out of the exchanging person's own drawer.

**Test:** `ExchangeForSomethingCheaperTest`.

## 3. The stockroom receives (B06)

**Was:** the help, the route and the screen all said a stock keeper receives
against an order; the request asked `purchases.manage` and answered 403.

**Now:** `purchases.manage` OR `inventory.manage` receives. Raising an order and
paying a supplier stay with Purchase orders.

**Test:** `PresetCanDoItsJobTest` (receive allowed; pay still refused).

## 4. Sizes on a purchase order (B05)

**Was:** the order form offered the design only. The server accepted it and
refused it at receipt (sizes are counted, a design is not) — the whole delivery,
plain items too. The reorder list drafted the same impossible line.

**Now:** the form offers each size as "Name / Size" with its cost (the size's,
else the design's), one line per size. The server refuses a size-less line for a
sized design when the order is MADE (`VARIANT_REQUIRED`). The reorder list
drafts plain items and names sized designs ("order them size by size").

**Test:** `OrderingSizesFromASupplierTest`, `ReorderListSeesSizesTest`, `orderLines.test.ts`.

## 5. Cancelling the rest still owes for what came (L1, B13)

**Was:** part of an order arrived (6,000 of dupattas); "cancel the rest" made
the whole order unbillable — the 6,000 vanished from the supplier's balance and
the purchases report. The Pay sheet's "due" was the ordered total.

**Now:** `Payable::billable` = not a draft, and not cancelled unless something
arrived; `Payable::KEPT` counts a cancelled order at what arrived. The Pay
sheet's due = arrived − paid (`payMath.dueOn`, `openOrders`). The cancel prompt
says what arrived stays owed.

**Test:** `CancellingTheRestStillOwesTest`, `payMath.test.ts`.

## 6. Small things (B22, B29 part)

Order dates were printed as raw ISO → `date:Y-m-d` on the model, the shop's own
format on screen. The customer's detail was fetched twice after a repayment.

## Proven

Every test above fails with its fix taken out (mutations: 18 + 3 + 1 + 3 + panel
cases, all caught). All five gates exit 0. Walked by hand on Zari (copy stack):
`panel/e2e/qa-kit/p1-*.mjs`.
