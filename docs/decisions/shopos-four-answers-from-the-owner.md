# Four answers from the owner, and a receipt that booked what never came

**Date:** 2026-10-13 (evening) · **Phase 0** of `docs/qa/SYSTEM-TEST.md`

Zari Clothing (`shopos-a-clothing-shop-lived-by-hand.md`) left four questions
for the owner. They answered; this is what was built, and one more bug found
on the way.

## A — a size on sale

**Was:** the lawn suit on sale (5,490 → 4,990) showed 4,990 on the list and the
till tile, and the bill for a size charged 5,490. A sale price lives on the
design; a size's own price was charged, and every size has one.

**Rule (owner):** a size with no price of its own takes the design's sale price.
Every size carries a price (the size grid fills it with the design's), so "no
price of its own" is a size priced the same as the design. That size follows
the design's *selling* price, sale included. A size priced differently (an XL at
5,990) keeps its own, and the design's sale does not touch it.

**Where:** `Product::priceOfSize()` on the server; `sizePrice()` in
`panel/src/modules/catalog/pricing.ts` on the panel. Used everywhere a size is
priced: the till, a tab, a phone order, a quotation, a promotion's cart, the
online store, an exchange, the offline bill and its shadow check, the offline
list, labels (the old price struck), and the size sheets on the till, a tab,
an order and the new-sale screen.

**Guard:** `test_no_selling_path_charges_a_sizes_row_price` fails on any
`(float) $variant->price` in actions, services or controllers.

## B — profit and expenses on the dashboard

**Was:** the cashier and the stock keeper read the day's profit and what the
shop had spent. There was no check at all.

**Rule (owner):** owner, manager and accounts see them; cashier and stock
keeper do not unless permitted. There are no roles here, so it is a permission:
profit to whoever holds `reports.view` (owner, manager, accounts, shift
supervisor), expenses to them and to whoever holds `expenses.manage`.

**Where:** `DashboardService::asSeenBy()` — the SERVER sends null (not zero) for
the figures, their change since yesterday, the chart's lines, the expense
breakdown, the recent expenses and the books; and `sees: {profit, expenses}`.
The panel draws a tile only for a figure that arrived.

## C — costs already missed

**Was:** sizes sold before 2026-10-13 were costed at the design's cost.

**Rule (owner):** fill them only from a verified purchase or stock record;
never guess.

**Where:** `php artisan shopos:size-costs-from-purchases --until="<when the fix
went live>" [--tenant=<id>] [--apply]`. A size line takes the cost on the order
line of the LAST delivery of that very size received before it was sold (per
piece, times the pack it was sold in). No such delivery: left exactly as it is,
and counted. A cooked dish (costed by recipe) is left alone. Without `--apply`
it only says what it would do; without `--until` it refuses.

**On the dev data:** 2,438 size lines, 0 would change, 6 already right, 2,431
have no receipt (their stock was typed in as opening stock, not received on an
order). On a live shop that received its sizes on purchase orders, more will
change. Run it without `--apply` first and read the list.

## D — the hold label

**Was:** the name typed when parking a ticket became the sale's customer name,
printed on the bill and kept on the sale.

**Rule (owner):** the label only identifies the ticket.

**Where:** the till no longer copies it into `customer_name`; the prompt says
"Name this ticket" and that it is not saved as the customer. A ticket parked
BEFORE this change still carries the label as its customer when resumed — those
are hours old at most.

## Found on the way — a receipt booked a line it was not told about

Mending C meant trusting receipts, so one was tested with two sizes ordered and
one delivered. The receive sheet leaves out a line set to 0 (the server takes
nothing below 0.001), and the server read a line left out as "all of it
arrived": the size still at the mill went into stock, the supplier was owed for
it, and its price was blended into the cost. With every line at 0 the sheet sent
an empty list and the whole order was received.

Now a receipt that sends a list — even an empty one — is exactly what arrived;
only a receipt that sends no list at all still means "everything owed".
`AReceiptSaysWhatArrivedTest`.

## Proof

- Backend: `ASizeOnSaleRingsUpAtTheSalePriceTest` (8), `ProfitIsForWhoeverReadsTheReportsTest` (5),
  `SizeCostsFromPurchasesTest` (9), `AReceiptSaysWhatArrivedTest` (4).
- Panel: `pricing`, `offlineCheckout`, `labels/sheet`, `KpiRow`, `replacements`, `takeOrder`, `browse` tests.
- Mutations (each fix undone in turn, the tests must fail): 8 on A's server side, 11 on B, 10 on C,
  2 on the receipt, 10 on the panel — all caught. Three survived their first run (a delta that was
  null anyway; the latest of two deliveries; a size ordered but not delivered) and the tests were
  extended until they were caught. The hold label is caught in the browser (`till-tenders.spec.ts`).
- By hand on Zari, on the copy stack: the cashier's dashboard had no profit or expenses (null in the
  answer); the suit's sizes read 4,990 on the size sheet, the cart and the bill, and the server did
  not correct the till; held as "QA blue shirt", resumed and paid — the sale has no customer
  (INV-000010). Owner and accounts still see both figures; the stock keeper sees neither.
- Browser specs on the copy: `till-tenders`, `labels-sheet`, `dashboard-period` — 20 passed.
