# Bugs found by testing — and where each one stands

Testing and fixing are split (the user's call, 2026-10-14):

- **The tester** (a cloud Claude Code session) only TESTS. It never changes code.
  It follows `docs/qa/TESTER-BRIEF.md` and hands back one bug file per pass.
- **The fixer** (the local session) fixes, adds a test that fails without the fix,
  runs the five gates, pushes, and updates the Status column below.

IDs are never reused. The tester continues from the next free number
(**next bug: B31 · next question: Q6**). `L…` = found by the fixer while fixing.

Status: **OPEN** · **FIXED `<commit>`** (re-test it) · **PART** (what is left is said) ·
**OWNER** (waits for a decision) · **TO BUILD** (decided, not built yet).

## Tracker

| ID | P | Area | One line | Status |
|---|---|---|---|---|
| B01 | P1 | Returns / drawer | Refund or exchange money by someone with no open shift (a supervisor) reaches no drawer; the cashier's drawer it left closes short | PART — a warning now shows BEFORE the press and in the answer (`e14bf9e`). TO BUILD: owner's answer below |
| B02 | P1 | Exchange | Exchange for something cheaper always refused (422 CHANGE_WITHOUT_CASH) | FIXED `e14bf9e` |
| B03 | P1 | Returns | Return of a split-tender sale refused (refund_method "split" invalid) | OPEN |
| B04 | P1 | Returns / khata | Return of a khata sale refused; sheet says money goes back though nothing is handed back | OPEN |
| B05 | P1 | Purchases | PO form cannot order sizes; a design-level PO for a sized item can never be received | FIXED `e14bf9e` `db44390` |
| B06 | P1 | Purchases / permissions | Stock keeper sees "Receive" and gets 403 | FIXED `e14bf9e` |
| B07 | P1 | Money forms | Double-click records money twice: khata payment, supplier payment, expense (no idempotency key) | OPEN |
| B08 | P1 | Receipt | Receipt counts the promotion twice ("You saved" wrong, lines do not add up) and prints "Balance due" for a bank-card offer | OPEN |
| B09 | P2 | Exchange | Exchange ignores "this shop requires a shift" | OPEN |
| B10 | P2 | Exchange / customers | Exchange drops the customer; loyalty taken back and never re-earned | OPEN |
| B11 | P2 | Dashboard | Dashboard profit ≠ Reports profit after a return (returned goods' cost not taken back) | OPEN |
| B12 | P2 | Purchases / cost | First purchase of a size sets cost to the new price, not the average with stock on the shelf | OPEN |
| B13 | P2 | Suppliers | Pay sheet "due" from the ordered total on a part-received PO | FIXED `db44390` |
| B14 | P2 | Day & banking | Sales without a shift never reach the day's figures; a closed day still takes sales | OPEN |
| B15 | P2 | Stocktake | Count by category: sub-categories not offered; parent finds nothing; error not shown | OPEN |
| B16 | P2 | Inventory | Design row = this place, size rows = all places; items without sizes never place-scoped | OPEN |
| B17 | P2 | Orders | Phone order → sale has tax 0 and channel "online" | OPEN |
| B18 | P3 | Till | "Paid Rs 4,990 · Change Rs 0" for a khata sale | OPEN |
| B19 | P3 | Khata statement | Raw code "Payment (bank_transfer)" | OPEN |
| B20 | P3 | Drawer panel | Khata cash shown as "Cash in (paid in, float)" | OPEN |
| B21 | P3 | Dashboard / Cashbook | Exchange credits counted as refunds and replacements as new sales — both sides inflated | OPEN |
| B22 | P3 | Purchase orders | Date printed raw ISO | FIXED `e14bf9e` `db44390` |
| B23 | P3 | Owner setup | City not pre-filled; setup page reopens after setup; Main branch city null | OPEN |
| B24 | P3 | Expenses | Cash expense filed to the header's place while the cash left a drawer at another place | OPEN |
| B25 | P3 | Quotes & advances | After "Bill & hand over" the layaway still says "Balance due"; handover payment not listed | OPEN |
| B26 | P3 | Bill & hand over | Due amount only a placeholder; "Bill it" disabled until typed | OPEN |
| B27 | P3 | Take order | Opening the page posts /orders/worth with no items → 422 + console error | OPEN |
| B28 | P3 | Till (bank offer) | Button total ≠ Amount due; sale-complete sheet never names the bank offer | OPEN |
| B29 | P3 | Many screens | Same request repeated in one step | PART — customers: extra fetch after a repayment removed (`db44390`); the rest OPEN |
| B30 | P3 | Exchange | Replacement sale stamped walk_in while the original was pos | OPEN |
| L1 | P1 | Purchases | Cancelling the rest of a part-received PO wiped what was owed for what arrived | FIXED `e14bf9e` `db44390` |

Commits: backend `e14bf9e` (branch `offline/v1/backend`), panel `db44390` (branch `offline/v1/admin-panel`) — Phase 1 part 1, pushed 2026-10-14.

## Owner's answers (2026-10-14, through ChatGPT) — to build

| Q | Answer | Fits the code? |
|---|---|---|
| B01 | (a) The refund leaves the **cashier's assigned drawer**. A supervisor PIN approval is mandatory, with an audit record: approval, amount, cashier, supervisor, drawer. If no drawer/shift is available, never quietly use another drawer. | Fits. No PIN approval exists yet (cash movements have an `approved_by` column) — a new piece to build. |
| Q1 | Loyalty points are earned only when payment is received. On khata they stay pending; a part payment earns its share; a refund/return takes earned points back. | Fits; "pending points" is new. |
| Q2 | A coupon applies to the price AFTER the promotion / automatic discount. Stacking rules clear; the final discount checked by the server. | Fits — changes today's rule (coupon on the pre-promotion subtotal). |
| Q3 | A manager may COUNT stock; applying the count needs an explicit permission. Every adjustment has a reason and an audit record; large differences need an approval (configurable). | Fits; the permission and the large-difference approval are new. |
| Q4 | Answered as a **staff salary advance** (payroll). | **CONFLICT** — Q4 was about a CUSTOMER's advance on a quote/layaway (LAY-000001), and payroll/HR is out of this version. Proposed: a customer's cash advance counts in the day's cash takings ("still in the shop") on the day it was taken, and is not counted again when the sale is billed. Waits for the user. |
| Q5 | COD cash goes to the designated receiving drawer of the branch where it is physically received. If a rider collects it, it first sits on the rider's outstanding COD; it reaches a drawer when handed over. | Fits — rider settlements already exist (`RiderSettlement`); the "no rider" path needs a receiving drawer. |

## Pass 1 — Phase 1, clothing shop (cloud tester, 2026-10-14) — details

Code tested: backend `e2c3a21`, panel `06a067e` (Phase 0 included; the Phase 1 part-1 fixes were NOT in it).
Fresh stack (PHP 8.4, MySQL 8.4, `migrate --seed`), shop "Zari Clothing QA" (retail · garments · Pro · 21 modules;
tax 18 % inclusive, loyalty on, discount ceiling 10 %, shift required; second place "Gulberg Outlet").
People: Sana owner; Bilal cashier, Usman stock keeper, Farah accounts, Hina manager, Saad shift supervisor.

**B01** — Bilal (cashier, shift float 2,000) sells INV-000001…6. Saad (supervisor, no shift) refunds INV-000001 Lawn Kurta M ×1 cash 2,500 from Bilal's drawer, and does two exchanges paid in cash at Bilal's counter (+1,400, +1,090). Expected: all three in Bilal's drawer. Actual: RET-000001, INV-000007, INV-000008 have `cash_session_id = null`; Bilal counted 17,590 vs expected 17,600 → −10 recorded against him. Cause: `ProcessSaleReturnAction` uses `BooksDrawer::tillFor(Auth::user())` (the refunder's own shift); `Rules/OwnOpenShift` forbids naming another's drawer; `SalesPage.tsx` sends no `cash_session_id`.

**B02** — Saad exchanges INV-000004 Embroidered Kurta XL 3,900 → Silk Dupatta 1,200. Sheet: "Refund to customer Rs 2,700"; Complete → 422 CHANGE_WITHOUT_CASH. Cause: `ProcessExchangeAction` pays with the credit as an "other" tender; `CreateSaleAction` refuses change larger than cash tendered.

**B03** — Return 1 of INV-000003 (Cotton Shirt L ×2, cash 2,000 + card 1,600) → 422 `refund_method` invalid; screen says only "The given data was invalid". Cause: `SalesPage.tsx` sends `refund_method: payment_method` ("split"); `StoreSaleReturnRequest` accepts `PaymentMethod::counter()` only; the server's own default (`$sale->payment_method`) has the same flaw.

**B04** — Same with INV-000002 (Lawn Suit Blue on khata 4,990): `refund_method = "credit"` → 422. The sheet says "Goes back to the customer Rs 4,990" though the khata should go down instead (server does it via `refund_credit`).

**B05** — PO picker offers "Lawn Kurta · cost 1,600", no sizes; PO-000001 placed; Receive → 422 VARIANT_REQUIRED for the whole delivery, so the plain Silk Dupatta on it is not received either.

**B06** — Usman → PO → "Receive all → stock in" → 403. Route allows purchases.manage OR inventory.manage; `ReceivePurchaseOrderRequest::authorize()` asked purchases.manage only.

**B07** — Double-click on Record / Save: Customers → khata payment 500 card → two payments (1,200 → 200); Suppliers → Pay 100 transfer → two payments; Expenses → 300 → two expenses. No `idempotency_key` on POST customers/{id}/payments, suppliers/{id}/payments, expenses (same pattern: incomes, sales/{id}/exchange, sale-documents/{id}/deposits). Copy the returns pattern (`returnIdemRef`).

**B08** — INV-000010 at the Outlet: Kids Frock 2Y + Lawn Suit Green; promotion "Kids 20 % off" −300; coupon EID10 −649; card with HBL offer −800. Stored: subtotal 6,490, discount 949 (includes the 300), promo_discount 300, total 5,541, card 4,741, bank_discount 800. Paper: Subtotal 6,490 / Kids 20% off −300 / Discount (EID10) −949 / Total 5,541 (does not add up) / Card 4,741 / **Balance due 800** / You saved 1,249 (really 949 + 800 from the bank). Cause: `resources/views/invoices/show.blade.php` prints promo then discount (which holds it), adds both again in "You saved", prints total − amount_paid as "Balance due" without the bank discount; the bank offer is never named.

**B09** — `pos_require_shift = true`; Saad with no shift completes exchanges INV-000007/8/14 — each a new sale with no shift. Only `SaleController` reads the setting; exchange, document conversion and order completion never do.

**B10** — INV-000004 belonged to Imran Butt (39 pts). Exchange → INV-000008 has no customer, 0 points; the return clawed back the 39. `ProcessExchangeAction` calls `CreateSaleAction` with no customer; `StoreExchangeRequest` has no customer field. Also: a khata customer cannot put the difference on khata (payments.*.method is counter only).

**B11** — Same day: Dashboard Today's Profit −53,615.58 vs Reports Net Profit −48,315.58; difference 5,300 = cost of the three lines returned. `DashboardService::dailyCogs()` sums cost of every sold line and never subtracts returned cost; `ReportService` does.

**B12** — Lawn Kurta S had 9, M 10, at the design cost 1,600 (sizes carry no cost of their own). Received 10 S + 10 M at 1,700. Expected S 1,652.63, M 1,650; actual 1,700 each. Silk Dupatta (own cost) blended right (714.71). Cause: `ReceivePurchaseOrderAction` blends with `$target->cost` (null for a size) → takes the new price; should fall back to the design's cost as sales do.

**B13** — PO-000002 ordered 50,000, received 41,500. Pay sheet: "PO-000002 · Rs 50,000 due"; +20,000 → "Still owed after this: Rs 30,000"; account then shows 21,500.

**B14** — Main's day: "Rung up Rs 22,690 · 6 sales" while Main sold 8 / 31,580 (the two shift-less exchanges missing). After Main's day was closed (07:57), an exchange (INV-000014, 08:16) and a phone-order sale (INV-000013, 08:13) were still recorded for that trading date; the closed day never includes them. The day is built from shifts; `after_day_close` only flags offline sync, never refuses.

**B15** — Stocktake → One category offers top level only (General, Women, Men, Kids, Accessories). Men → 422 STOCK_COUNT_EMPTY (shirts are in Men → Shirts); the modal shows nothing. Whole-shop count worked (Cotton Shirt M 12 → 11, short valued 1,000).

**B16** — Lawn Kurta: Main S19 M10 L10 XL10, Outlet M8. Inventory: design row 49 (Main only) but size M row 18 (all places). Silk Dupatta: Inventory 32 at Main, Main holds 24. API gives each size `branch_stock` and `stock_quantity`; the design row sums branch_stock, size rows show stock_quantity.

**B17** — Hina takes a phone order (Cotton Shirt XL, delivery, COD) → out for delivery → complete. INV-000013: tax 0, tax_rate 0 (the till charges 18 % inclusive = 274.58); channel "online" though "Came in by Phone".

**P3, one line each** — B18 till sheet "Paid … Change 0" on khata (amount_paid = total) · B19 "Payment (bank_transfer)" · B20 khata cash as "Cash in (paid in, float)" (`CashDrawerPanel.tsx`) · B21 refunds 8,900 though 2,500 left the shop (exchange credits refund_method=other counted) · B22 PO date raw · B23 setup: city not pre-filled, /tenant/setup reopens after setup, a device signed in mid-setup stays stuck, Main city_id null · B24 cash expense filed to the header's place (Main) while cash left the Outlet drawer · B25 LAY-000001 still "Balance due 2,490" after Bill & hand over; that payment not under "Payments received" · B26 due amount only a placeholder; "Bill it" disabled until typed (`DocumentDetailPage.tsx`) · B27 Take order posts /orders/worth with no items → 422 + console error · B28 "Complete sale · Rs 5,541" while Amount due 4,741; sale-complete sheet never mentions the bank offer · B29 repeats: /pos/session ×3, /pos/registers ×2, /pos/terminal ×2, /products ×2, /promotions/preview ×2 per sale, lists ×2–3 after a save · B30 exchange's replacement stamped walk_in, original pos.

Phase 1 checklist result of this pass: 1 FAIL (B01, B11, B03, B04) · 2 FAIL (B02) · 3 PASS (B07) · 4 FAIL (B05, B06, B12, B13) · 5 PASS (B16) · 6 PASS (B11, B07, B24) · 7 FAIL Main (B14), PASS Outlet · 8 FAIL (B08) · 9 PASS (B25, B26) · 10 PASS with B15 · 11 PASS with B17 · 12 sales agree (50,111 on four screens); profit (B11) and stock of a size (B16) disagree.
Not tested: storefront checkout (customer side), offline, printers, phone/tablet, admin beyond making the shop.
