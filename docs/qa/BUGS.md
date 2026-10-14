# Bugs found by testing — and where each one stands

Testing and fixing are split (the user's call, 2026-10-14):

- **The tester** (a cloud Claude Code session) only TESTS. It never changes code.
  It follows `docs/qa/TESTER-BRIEF.md` and hands back one bug file per pass.
- **The fixer** (the local session) fixes, adds a test that fails without the fix,
  runs the five gates, pushes, and updates the Status column below.

IDs are never reused. The tester continues from the next free number
(**next bug: B52 · next question: Q11**). `L…` = found by the fixer while fixing.

Status: **OPEN** · **FIXED `<commit>`** (re-test it) · **PART** (what is left is said) ·
**OWNER** (waits for a decision) · **TO BUILD** (decided, not built yet).

## Tracker

| ID | P | Area | One line | Status |
|---|---|---|---|---|
| B01 | P1 | Returns / drawer | Refund or exchange money by someone with no open shift (a supervisor) reaches no drawer; the cashier's drawer it left closes short | PART — warning before the press on both sheets and now in BOTH answers (return `e14bf9e`, exchange `5e2bcf6`). TO BUILD: the cashier's drawer + supervisor PIN (owner's answer below) |
| B02 | P1 | Exchange | Exchange for something cheaper always refused (422 CHANGE_WITHOUT_CASH) | FIXED `e14bf9e` · re-tested PASS (pass 2) |
| B03 | P1 | Returns | Return of a split-tender sale refused (refund_method "split" invalid) | FIXED `5e2bcf6` `3835cbb` — split sale goes back in cash |
| B04 | P1 | Returns / khata | Return of a khata sale refused; sheet says money goes back though nothing is handed back | FIXED `5e2bcf6` `3835cbb` — khata comes off first; the sheet says how much |
| B05 | P1 | Purchases | PO form cannot order sizes; a design-level PO for a sized item can never be received | FIXED `e14bf9e` `db44390` · re-tested PASS (pass 2) |
| B06 | P1 | Purchases / permissions | Stock keeper sees "Receive" and gets 403 | FIXED `e14bf9e` · re-tested PASS (pass 2) |
| B07 | P1 | Money forms | Double-click records money twice: khata payment, supplier payment, expense (no idempotency key) | FIXED `5e2bcf6` `3835cbb` — 7 money forms answer once per key (AnswerOnce) |
| B08 | P1 | Receipt | Receipt counts the promotion twice ("You saved" wrong, lines do not add up) and prints "Balance due" for a bank-card offer | FIXED `5e2bcf6` — promotion once, bank offer named, no balance due |
| B09 | P2 | Exchange | Exchange ignores "this shop requires a shift" | OPEN |
| B10 | P2 | Exchange / customers | Exchange drops the customer; loyalty taken back and never re-earned | OPEN |
| B11 | P2 | Dashboard | Dashboard profit ≠ Reports profit after a return (returned goods' cost not taken back) | OPEN |
| B12 | P2 | Purchases / cost | First purchase of a size sets cost to the new price, not the average with stock on the shelf | OPEN |
| B13 | P2 | Suppliers | Pay sheet "due" from the ordered total on a part-received PO | FIXED `db44390` · re-tested PASS (pass 2) |
| B14 | P2 | Day & banking | Sales without a shift never reach the day's figures; a closed day still takes sales | OPEN |
| B15 | P2 | Stocktake | Count by category: sub-categories not offered; parent finds nothing; error not shown | OPEN |
| B16 | P2 | Inventory | Design row = this place, size rows = all places; items without sizes never place-scoped | OPEN |
| B17 | P2 | Orders | Phone order → sale has tax 0 and channel "online" | OPEN |
| B18 | P3 | Till | "Paid Rs 4,990 · Change Rs 0" for a khata sale | OPEN |
| B19 | P3 | Khata statement | Raw code "Payment (bank_transfer)" | OPEN |
| B20 | P3 | Drawer panel | Khata cash shown as "Cash in (paid in, float)" | OPEN |
| B21 | P3 | Dashboard / Cashbook | Exchange credits counted as refunds and replacements as new sales — both sides inflated | OPEN |
| B22 | P3 | Purchase orders | Date printed raw ISO | FIXED `e14bf9e` `db44390` · re-tested PASS (pass 2) |
| B23 | P3 | Owner setup | City not pre-filled; setup page reopens after setup; Main branch city null | OPEN |
| B24 | P3 | Expenses | Cash expense filed to the header's place while the cash left a drawer at another place | OPEN |
| B25 | P3 | Quotes & advances | After "Bill & hand over" the layaway still says "Balance due"; handover payment not listed | OPEN |
| B26 | P3 | Bill & hand over | Due amount only a placeholder; "Bill it" disabled until typed | OPEN |
| B27 | P3 | Take order | Opening the page posts /orders/worth with no items → 422 + console error | OPEN |
| B28 | P3 | Till (bank offer) | Button total ≠ Amount due; sale-complete sheet never names the bank offer | OPEN |
| B29 | P3 | Many screens | Same request repeated in one step | PART — customers: extra fetch after a repayment removed (`db44390`); the rest OPEN · customers part re-tested PASS (pass 2); staff page and /orders/waiting still ask twice |
| B30 | P3 | Exchange | Replacement sale stamped walk_in while the original was pos | FIXED `3835cbb` — the replacement keeps the sale's channel |
| B31 | P1 | Exchange | Exchange sheet prices the replacement without automatic promotions — said "hand back 1,000", the server gave 1,300 change | FIXED `3835cbb` — the sheet asks the server (/sales/worth) |
| B32 | P2 | Reorder → PO | Reorder draft prices a pack as a piece (Box of 5 at 3,600 → 37 × 3,600) | OPEN |
| B33 | P2 | Suppliers / Pay | Pay sheet offers a cancelled part-received PO; server refuses 422 PO_NOT_PAYABLE | OPEN |
| B34 | P2 | Online orders | Delivery fee lost on completion: order 7,640 (fee 150, COD paid) → sale 7,490; the 150 is nowhere | OPEN |
| B35 | P3 | Purchases / places | Stock keeper offered "Receive all" on another place's PO → 403 NOT_YOUR_PLACE | OPEN |
| B36 | P3 | Storefront | "My orders" shows raw quantity "1.000 ×" | OPEN |
| B37 | P3 | Storefront | Shop page "Items held for you" lists holds at OTHER shops | OPEN |
| B38 | P1 | Permissions / money | Cashier (and waiter) gets `unit_cost` on every sale line (GET /sales/{id}) | FIXED `5e2bcf6` — cost stripped on every line model |
| B39 | P1 | Permissions / dashboard | Dashboard gives every staff member takings, supplier payables, every place's revenue and the audit feed (kitchen sees 515,554) | FIXED `5e2bcf6` `3835cbb` — dashboard stripped per permission |
| B40 | P1 | Permissions / dine-in | Waiter without sales.void voids served food and cancels a whole tab (200, no approval) | FIXED `5e2bcf6` `3835cbb` — sent food needs sales.void; voided_by kept |
| B41 | P1 | Permissions / purchases | inventory.manage alone receives any PO — forecourt attendant took 1,000 L petrol into stock past the tanker gate; pharmacist reads POs and supplier balances | FIXED `5e2bcf6` — tank fuel refused on a PO (made and received) |
| B42 | P2 | Place wall | /inventory/movements not scoped to the person's place; branch_id filter ignored | OPEN |
| B43 | P2 | Module off / dashboard | Expenses module off → dashboard expenses 0 and profit without them; Reports still count them | OPEN |
| B44 | P3 | Screens | A screen you may not use, typed in, lands silently on the dashboard | OPEN |
| B45 | P3 | Screens | /tenant/pharmacy opens for a cashier and fills with a 403 + console error | OPEN |
| B46 | P3 | API figure | supplier.outstanding reads 0 inside a PO answer (sums not loaded) | FIXED `5e2bcf6` — null, not 0, when not worked out |
| B47 | P1 | Offline / price | Offline sale REFUSED at sync when the price changed while offline — the money is in the drawer, nothing recorded | OWNER — Q10 below (the server re-prices offline sales on purpose) |
| B48 | P1 | Offline / sync | One offline sale with a DELETED product turns the whole /pos/sync into a 422 — the batch (up to 50) retried for ever, none shown as failed | FIXED `5e2bcf6` `3835cbb` — each synced sale checked on its own; the till splits a refused batch |
| B49 | P2 | Offline / refused | Refused offline sales cannot be re-rung or cleared; the red strip stays for ever; the owner never hears of them | OPEN |
| B50 | P2 | Offline / sign-out | Signing out with sales waiting gives no warning (nothing is lost) | OPEN |
| B51 | P2 | Offline / stock | The last piece sold on two tills offline: both accepted (stock −1), nothing flagged | OPEN |
| L1 | P1 | Purchases | Cancelling the rest of a part-received PO wiped what was owed for what arrived | FIXED `e14bf9e` `db44390` · re-tested PASS (pass 2) |

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

## Owner questions from pass 2 (2026-10-14) — answered by the user the same day

| Q | Question | Note |
|---|---|---|
| Q6 | Online and storefront orders earn no loyalty points (till sales do). Should a paid online order earn points? | WAITING — Q1's answer (points on payment) would cover it. |
| Q7 | The Subscription screen (plan price, payments to the platform, bank references) is open to every staff member, kitchen included. On purpose in the code ("what the shop pays is not a secret from the people who work in it", `shopNav.tsx`). Keep, or owner only? | **ANSWERED: owner only** — BUILT `5e2bcf6` `3835cbb` (screen, menu, API) |
| Q8 | A cashier and a one-place stock keeper read every place's COUNT of an item (`/products/{id}/branch-stock`, "check other branches" on the till). On purpose in the code. Keep (counts only, no money), or wall it? | **ANSWERED: keep** — counts only, no cost or value. Not a bug. |
| Q9 | Supplier balances, PO totals and payment status reach anyone with inventory.manage (stock keeper, pharmacist, forecourt attendant). Strip the money for people who cannot pay a supplier? | **ANSWERED: strip it** — BUILT `5e2bcf6` `3835cbb` (HidesSupplierMoney on suppliers and orders; dashboard payable too) |

## Owner question from the fixer (2026-10-14) — waiting

| Q | Question | Fixer's recommendation |
|---|---|---|
| Q10 | B47: a till offline across a price change sold at the OLD price (1,000) and took the cash; the server re-prices every offline sale on purpose ("the till's figure was only ever a receipt" — a till cannot be trusted with money) and so refused it, and nothing was recorded. Which wins? | Record the sale as the till rang it (money already changed hands), put the difference on the sale as "price changed while offline", and flag it in the offline report for the owner. The server still prices it — it only stops refusing what was already paid. |

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

## Pass 2 — re-test, Phase 1 leftovers, Phase 2 part (cloud tester, 2026-10-14) — details

Code tested: backend `e14bf9e`, panel `db44390`, docs `99677ad`. Own stack. Shops: Zari Clothing QA (2 places; + imran Purchasing, nadia Online orders), Johar Café & Grill (waqas Waiter, kamran Kitchen), CarePlus Pharmacy (rehan Pharmacist), Canal Road Fuels (javed Forecourt attendant), Trendz Retail (shop B). Phase 2 probe: every shop route (359) as each set — 4,341 calls (writes with made-up ids / empty bodies).

**Re-tests:** R1 PASS (INV-000016 → INV-000017, change_due 2,700, drawer 6,900 → 4,200) · R2 PASS · R3 FAIL part (exchange answer has no `meta.warnings`; `SaleController` exchange returns `ApiResponse::created` with no meta, unlike processReturn) · R4 PASS · R5 PASS · R6 PASS (note: an INACTIVE size sent by API is accepted on a PO) · R7 PASS · R8 PASS · R9 PASS (owes 29,400; report 79,400 kept) · R10 PASS · R11 PASS · R12 PASS.

**B31** — Saad, INV-000021 → Exchange; automatic promotion "Kids 20% off"; replacement a Kids item. Sheet: "Hand back in cash Rs 1,000"; INV-000023 `change_due` 1,300 → drawer 300 over. Cause: `panel/src/modules/sales/replacements.ts` `replacementsTotal` → `tillBill({discount: 0})` with no promotions; `SalesPage.tsx` uses it. Fix: ask the server what the replacement is worth (returns/worth pattern).

**B32** — Hina → Inventory → Needs reordering → Order these. Silk Dupatta last bought as Box of 5 at 3,600 → draft PO-000005 37 × 3,600 = 133,200. Cause: `Support/LastBoughtFrom.php` returns `unit_cost` without `unit_factor`; `DraftOrdersFromReorderList.php` puts it on a per-piece line.

**B33** — Suppliers → Gul Textile Mills → Pay offers "PO-000003 · Rs 29,400 due" (cancelled after part receipt); save → 422 PO_NOT_PAYABLE "pay on account instead". `RecordSupplierPaymentAction` refuses Cancelled; `payMath.openOrders` offers it. One rule both sides.

**B34** — Storefront, delivery + COD, shop delivers itself: ORD-000002 7,640 (goods 7,490 + fee 150), "Paid" → INV-000025 7,490. Cause: `OrderService::complete()` `$goodsPaid = subtotal − discount`.

**B35** — Usman (Main) → PO-000006 addressed to Gulberg Outlet → "Receive all" offered → 403 NOT_YOUR_PLACE. `PurchaseOrdersPage.tsx` shows Receive regardless of place.

**B36** — `MyOrdersPage.tsx` prints `{it.quantity}` raw. **B37** — `marketplace/components/MyReservations.tsx` not filtered by shop on `MarketShopPage.tsx`.

**B38** — Bilal (cashier) GET /sales/{id}: INV-000026 Cotton Shirt XL unit_price 1,800, **unit_cost 1,000** (and on 3 more sales). `SaleController::show()` serialises items as-is; `HidesCostPrice` is only on Product/ProductVariant. Same for waiter. Fix on the models with a cost: sale items, return items, ticket items, document items, order items. Test as a cashier.

**B39** — GET /dashboard: Kamran (Kitchen only) at Johar Café gets today.revenue 515,554.40, refunds, recent_sales, branches (Main 515,554.40, Emporium 405,852.40), money_owed.receivable, till.banked_today, highlights. Usman/Bilal/Nadia at Zari get revenue 62,470, money_owed.payable 29,400, recent_sales, activity (audit rows). `DashboardService::asSeenBy()` strips only profit/expenses. Fix: strip per permission — takings blocks for people with no sales/reports read; payable for people who cannot read suppliers; activity without READS_AUDIT; other places for one-place people; hide the tiles.

**B40** — Waqas (waiter) TAB-00182: Orange Juice fired → ready → served; DELETE /restaurant/tickets/{tab}/items/{item} → 200 "Item voided"; POST /restaurant/tickets/{tab}/cancel → 200 "Tab cancelled". Routes `api.php` 1078 / 1086 need only sales.manage; `RestaurantTicketController` voidItem / cancel check `assertMayWork()` only. Fix: sales.void (or the planned approval) to void a fired/served item or cancel a tab with fired items; unfired removal stays free; record who approved.

**B41** — Javed (forecourt attendant: sales.manage, customers.manage, inventory.manage): owner's PO 1,000 L petrol → POST /purchase-orders/{id}/receive → 200, stock 27,841.538 → 28,841.538, no dip; POST /fuel/deliveries → 403. Rehan (pharmacist) reads POs and supplier balances; receive passes the gate. Route `api.php:480` purchases.manage,inventory.manage; `READS_PURCHASE_ORDERS`/`READS_SUPPLIERS` include inventory.manage.

**B42** — Usman (Main only) GET /inventory/movements?per_page=100 → 72 rows, 14 at Gulberg Outlet with quantity_after; `?branch_id=` ignored for the owner too. `InventoryController::movements()` has no place scope or filter. /inventory/by-place is walled correctly.

**B43** — Admin switches Expenses off for Zari: dashboard expenses 59,500 → 0, profit −62,127.03 → −4,127.03; Reports still 59,500 / −47,197.61; `sees.expenses` stays true. `DashboardService` `$keepsBooks` from the module.

**B44** — Bilal types /tenant/reports, /expenses, /staff, /settings, /purchases → lands on /tenant with no word (33 screens). `guards.tsx` `RequireTenantScreen` → `<Navigate to="/tenant">`. **B45** — Bilal /tenant/pharmacy opens; GET /pharmacy/dispensing 403 + console error; `screenPermissions.ts` gates on sales.manage, data needs reports.view or inventory.manage. **B46** — `Supplier::outstanding` appended from sums the PO queries never load → 0.

**Known bugs, no change:** B12, B16, B17 (online-order sale tax 0), Q5 (INV-000031 COD pickup, no drawer).

**Phase 2 result:** menus PASS (waiter, pharmacist, attendant, purchasing screens not walked); typed URLs never open (B44, B45); API 403s PASS except B40, B41; money fields FAIL (B38, B39); place walls FAIL on reads (B42, Q8), moves PASS; one shop vs another PASS (74 requests on shop B's ids → 404/403, shop B unchanged); extra fields PASS (forged price/cost/status/place/shop/invoice/training ignored on a sale; PO status refused); module off PASS with B43; staff suspended/deleted/permission removed PASS (401/403 at the next request).
Per set: Cashier FAIL (B38, B39) · Supervisor PASS · Waiter FAIL (B40) · Kitchen FAIL (B39) · Stock keeper FAIL (B39, B42) · Purchasing PASS · Online orders PASS (B39) · Accounts PASS · Forecourt attendant FAIL (B41) · Pharmacist FAIL (B41) · Manager PASS.
Not tested: waiter settling own tab; cashier settling a waiter's tab; pump sale + forecourt shift close; pharmacist dispense/batches/real receipt; waiter/pharmacist/attendant/purchasing screen walks.
Data left in the tester's stack: Bilal, Saad, Hina shifts open at Zari Main; QA Extra Fields customer, QA Extra Product (999), QA Phase2 Supplier; café TAB-00182 voided; fuels 1,000 L petrol PO received.

## Pass 3 — Phase 3, offline and sync (cloud tester, 2026-10-14) — details

Code tested: backend `e14bf9e`, panel `db44390` (same as pass 2 — the pass-2 fixes were not pushed yet). The BUILT panel (`vite preview` :4173, service worker on); the line cut with Playwright `setOffline`. Both sides checked: the till's IndexedDB outbox `shopos-till/outbox` and the server. Zari Main; Bilal (cashier) and Saad (supervisor) with open shifts; Trendz Retail signed in on the same device; the owner changing things by API.

Checklist: 1 answer lost → resent → ONE sale **PASS** (INV-000033, `duplicate`) · 2 last piece on two tills **FAIL B51** · 3 price changed offline **FAIL B47** · 4a product switched off **PASS** (refused clearly) with B49 · 4b product deleted **FAIL B48** · 5 staff switched off offline **PASS** (401 → sign-in; Saad sent it, rung_by Bilal, Bilal's shift) · 6 storage full **BLOCKED** (headless Chromium would not fill IndexedDB) · 7 sign out with sales waiting **FAIL B50** (nothing lost) · 8 another shop on the same device **PASS** · 9 refused → shown, fixable **FAIL B49, B48** · 10 offline SIZE sale **PASS** (M 8 → 7; Blue at sale price 4,990; Kids 20 % off stored).

**B47** — Bilal's till has QA Price Change at 1,000; line cut; owner PATCHes it to 1,200; Bilal sells offline for 1,000 cash (OFF-TILL-YUJU-000004); line back → sync `failed` "Amount paid (1,000.00) is less than the total (1,200.00)"; no sale, no stock out; drawer 1,000 over. Same for a sale price ending. Cause: `PosSyncController::apply()` sends `'trusted_prices' => false`; `CreateSaleAction` re-prices at today's price and refuses the payment. Fix: keep the till's price for a synced sale; record the difference as a pricing variance / offline violation (`pos/pricing-variances` exists).

**B48** — Offline: 3 sales (OFF-TILL-YUJU-000004/5/6); owner DELETEs QA Delete Me; reconnect → POST /pos/sync **422** (`operations.0.sale.items.0.product_id` invalid); all rows stay pending "The given data was invalid.", retried for ever, shown as "saved here". Cause: `Http/Requests/Pos/SyncRequest.php` borrows `StoreSaleRequest` rules (scoped `exists` on product_id) for every op; panel `offline/outbox/flush.ts` `runFlush` catch marks the whole batch for retry. Fix: validate each op on its own and answer `failed` for that op only; on the till, a 4xx is not a network failure.

**B49** — POS red strip "N offline sales were refused — the money was taken and nothing was recorded" → See which: only Close; strip never clears; never reaches the server (offline report "flagged 0"). `PosPage.tsx` sheet (~4786) and strip (~2175). Fix: per row "Ring it again now" (till's price kept) and "Dealt with — reason"; send refused rows to the server as a record.

**B50** — Saad with OFF-TILL-9QFY-000001 waiting → avatar → Sign out: no warning (sent later as INV-000038). `components/header/UserDropdown.tsx` `signOut()`. Fix: count this shop's pending rows; confirm before signing out.

**B51** — QA Last Piece (1 in stock) sold offline by Bilal (OFF-TILL-YUJU-000003) and Saad (OFF-TILL-VBLY-000001) → INV-000034, INV-000035, stock −1; `offline_violations` null on both; /reports/offline flagged 0; not on low stock. `PosSyncController::apply()` records no violation for stock below zero; `OfflinePolicy::violations()` does not look. Fix: a synced line that takes a place below zero adds a violation ("another till sold it too").

Not tested: storage full (BLOCKED — notes: `StorageWarning` mounted only in the Open-shift sheet and checked once at boot; `offlineCheckout.ts` `enqueue` has no quota-error handling); phone/tablet/installed PWA/power cut (Phase 11); `e2e/offline-shift.spec.ts` not run.
Data left: INV-000032…42; QA Last Piece −1, QA Price Change 1,200, QA Switch Off off, QA Delete Me deleted; Bilal's drawer 1,700 over (refused sales).
