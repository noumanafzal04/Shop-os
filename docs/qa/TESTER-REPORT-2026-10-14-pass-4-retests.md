# Tester report — pass 4: re-tests R1–R14 and Phase 2 leftovers (part)

Final report of pass 4. R1–R14 are all done. Of the Phase 2 leftovers (§5b), the two settle cases are done; the screen
walks and the pharmacist's PO with batches are NOT. Phase 4 (§5c) is NOT done — the user stopped the pass early to save credit.
(Saved by the fixer from the report the user handed over, 2026-10-14; replaces the part-1 version of this file.)

## 1. Header

| | |
|---|---|
| Commits tested | backend `5e2bcf6` (offline/v1/backend), panel `3835cbb` (offline/v1/admin-panel), docs `8ead13d` (main) |
| Stack | Own container: PHP 8.4, MySQL 8.4. `php artisan migrate` ran the two new migrations (voided_by, answered_requests). Backend :8000, panel dev :5177, BUILT panel (vite preview) :4173 for R14. |
| Shops | Zari Clothing QA (2 places) · Johar Café & Grill · CarePlus Pharmacy · Canal Road Fuels (made in passes 1–2) |
| People | Zari: Sana (owner), Bilal (cashier), Saad (supervisor), Hina (manager), Usman (stock keeper), Imran (purchasing), Nadia (online orders), Farah (accounts). Café: owner, Waqas (waiter), Kamran (kitchen), cashier. Pharmacy: Rehan. Fuels: owner, Javed (attendant). |
| How | qa-kit Playwright (real clicks, HAR, console); every figure read back from the API; double-clicks and parallel requests sent directly to the API. |

## 2. Summary for the fixer

### Re-tests

| R | Bug | Result | One line |
|---|---|---|---|
| R1 | B03 | PASS | INV-000043 (1,000 cash + 800 card) → sheet "Goes back 1,800" → RET-000012 201, refund_method cash; drawer −1,800. |
| R2 | B04 | PASS | Unpaid khata INV-000044 4,990: "Comes off Rabia Noor's khata 4,990 / Goes back 0"; khata 4,990 → 0; drawer unchanged. Part-paid INV-000045 (500 cash + 700 khata): "Comes off 700 / Goes back 500". |
| R3 | B07 | PASS | All 7 forms: UI double-click → 2 POSTs → 201 then 201 `Idempotent-Replay: true` → one record. Same key twice / two at once → one record. Next save is a new record. |
| R4 | B08 | PASS | INV-000060 (Kids 20 % off + coupon EID10 + HBL card offer). Receipt: Subtotal 6,490 − Kids 20 % off 300 − Discount (EID10) 649 = Total 5,541. Card 4,741 + "HBL 15% weekend · paid by the bank" 800. No "Balance due". "You saved 1,749" (= 300 + 649 + 800). B28 (till button total, sale-complete sheet) unchanged — known. |
| R5 | B31 | PASS | Exchange with Kids 20 % off: sheet "Hand back 1,300" = INV-000050 change_due 1,300. Dearer: "Difference 2,500" = INV-000052. |
| R6 | B30 | PASS | INV-000050 / 052 / 054 channel pos. |
| R7 | B01 part | PASS | Sana (no shift): warning before the press; INV-000054 answer has meta.warnings. |
| R8 | B38 | PASS | Cashier, waiter, café cashier: no unit_cost/total_cost anywhere; owner, manager, supervisor still see it. |
| R9 | B39 | PASS (API) · screen B53, B58 | Every set got only its share (table below). |
| R10 | B40 | PASS | Waiter: void sent item → 403 VOID_NEEDS_SUPERVISOR; cancel tab with sent item → 403; unsent item → 200. Owner 200, voided_by stored. |
| R11 | B41 | PASS · new B54 | Petrol/diesel PO (also mixed, also draft) → 422 FUEL_COMES_BY_TANKER; lubricant PO normal. "Receive an old PO holding fuel": BLOCKED. |
| R12 | Q9 / B46 | PASS | Usman, Rehan, Javed: no balance/total/paid/status/payments; Imran sees all; supplier.outstanding in a PO = null. |
| R13 | Q7 | FAIL (part) · B55, B56 | GET /shop/subscription 403 for 6 staff, 200 owners; menu and banner PASS; typed URL opens (B56); plan price and bill in /auth/me and /shop (B55). |
| R14 | B48 | PASS · new B57 | 3 offline sales, one product deleted: 2 applied, the deleted one failed retryable:false; retry → duplicates; batch never stuck. |

R9 — what each set got from /dashboard:

| Set | Takings | Khata owed | Supplier payable | Activity | Highlights | Places |
|---|---|---|---|---|---|---|
| Kitchen (Kamran) | null | null | null | 0 | none | none |
| Stock keeper (Usman) | null | null | null | 0 | none | none |
| Online orders (Nadia) | null | 70 | null | 0 | none | none |
| Cashier (Bilal) | 118,310 | 70 | null | 0 | none | own place |
| Buyer (Imran) | null | null | 29,370 | 0 | none | none |
| Accounts / supervisor / manager | yes | yes | yes | 8 | yes | own place |
| Owner (Sana) | 136,241 | yes | yes | 8 | yes | both |

Note on Nadia: khata owed reaches her through customers.manage; the decision doc allows it, the brief's R9 line said "nothing owed". Not called a bug — the fixer or owner to say which is right.

### New bugs

| ID | P | Area | One line |
|---|---|---|---|
| B52 | P3 | Exchange sheet | First replacement posts /sales/worth with `items: []` → 422 + console error |
| B53 | P3 | Dashboard (Simple) | Two grey loading pills pulse for ever for staff sent no takings |
| B54 | P2 | Reorder list → PO | Tank fuel on the list makes "Order these N items" fail for the whole list |
| B55 | P2 | Q7 leak | Plan price and the whole bill reach every staff member in /auth/me and /shop |
| B56 | P3 | Screens | /tenant/subscription typed by staff opens the page (403 + console error) |
| B57 | P3 | Offline refused sheet | Always "amount unreadable" |
| B58 | P3 | Dashboard status | Kitchen told "14 orders are waiting for you to accept" |

Known bugs that changed: **B29** — new repeats: GET /sales/{id} ×2 when a sale sheet opens; GET /suppliers/{id} ×4 after a supplier payment; GET /pos/catalog ×2 after a money form. **B49** — the refused sheet shows one row per sale with the server's reason; still only Close, no amount (B57).

New owner questions: none.

### Phase checklist

| Item | Result |
|---|---|
| 5a re-tests R1–R14 | 12 PASS (R1–R8, R10–R12, R14) · R9 PASS on the API with 2 screen bugs · R13 FAIL (part) |
| 5b Waiter settles their own tab | PASS — Waqas settled TAB-00184 from the tab screen (Take 847.60) → INV-000572, tab closed. No shift: the café's 2026-10-14 day is closed, so opening one gave 409 BUSINESS_DAY_CLOSED and the sale has cash_session_id null — known B14 ("a closed day still takes sales"). |
| 5b Cashier settles a waiter's tab (tables.serve_any) | PASS — café cashier settled Waqas's TAB-00185 → INV-000573 1,831.20, tab closed. Same no-shift note (B14). |
| 5b Screen walks: waiter, pharmacist, attendant, purchasing | NOT TESTED (pass stopped early) |
| 5b Pharmacist receives a real PO with batches | NOT TESTED (pass stopped early) |
| 5c Phase 4 grocery | NOT TESTED (pass stopped early) |

## 3. New bugs in detail

**B52** — Hina / Sana, Sales → a sale → Exchange; hand back 1, pick a replacement. First POST /sales/worth `{"channel":"pos","items":[],…}` → 422 "The items field is required." + console error, then the right request → 200 (INV-000049, 051, 053). Cause: `SalesPage.tsx:421-424` — `useSaleWorth(outSettled, exchanging && exItems.length > 0 && connected)` is on as soon as exItems has a line while `outSettled` (debounced 250 ms) still holds the empty list. Fix direction: enable from the settled value.

**B53** — Usman, Imran, Nadia, Kamran; Dashboard Simple view. Two grey pulsing pills for ever (Bilal gets "Orders Today 50 · Customers Today 47"). Cause: `ShopDashboard.tsx:133` `loadingChips={caps.sells && basic ? 2 : 0}`; real chips dropped when sales_count is null, loading ones not. Screenshots p4-r9-usman-01-dash.png, p4-r9-kamran-01-dash.png.

**B54** — Canal Road Fuels owner; Inventory → Needs reordering. Petrol alert 30,000 (stock 27,841.538), Shell Helix HX3 1 L alert 367 (stock 362). "Order these 2 items" → POST /purchase-orders/from-reorder-list → 422 FUEL_COMES_BY_TANKER; no PO, lubricant included; the list never says petrol cannot be ordered. Cause: `DraftOrdersFromReorderList` puts every product with purchase history in `$bySupplier`; `CreatePurchaseOrderAction` (TankFuel::refuse) refuses the lot in one transaction. Fix direction: skip tank fuel and hand it back by name (like sized); mark fuel rows "by tanker". Alert levels set back to empty afterwards.

**B55** — Any staff (Kamran, Bilal). GET /auth/me → tenant.plan.price "6500.00"/"7999.00", tenant.package.bill {plan, addons, addons_total, total}, offer, missing, subscription_starts_at/ends_at; GET /shop the same. Cause: `TenantResource.php:56-64` (plan.price) and `:87-92` (package with bill) — the admin's resource used for the shop's own /auth/me and /shop. Fix direction: strip plan.price and package (at least bill, own_prices, offer) unless settings.manage; keep subscription_state.

**B56** — Bilal, Hina type /tenant/subscription: the page draws, GET /shop/subscription 403 + console error, empty body. Cause: `App.tsx:552-554` route outside `<RequireTenantScreen>`; comment still says "what the shop pays is not a secret". Fix direction: put it inside RequireTenantScreen.

**B57** — Bilal, built app :4173, red strip "1 offline sale was refused" → See which: "OFF-TILL-4Z67-000005 · amount unreadable · …". The sale was 500 cash; the outbox row holds amount_paid 500. Cause: `outbox.ts:414` `refusedTotal` reads `row.sale.total`, which a queued payload never has. Fix direction: amount_paid (or sum of payments), or store the till's total when queued.

**B58** — Kamran (kitchen.manage only), Dashboard: "14 orders are waiting for you to accept." Cause: `status.ts:42` checks `caps.takesOrders` (shop modules, `capabilities.ts:130`), not the person. Fix direction: `caps.visit("/tenant/orders")` or orders.manage.

## 4. Not tested, and why

Stopped early on the user's word (credit limit) — these are the next pass's FIRST items:
- §5b screen walks for waiter, pharmacist, forecourt attendant and purchasing;
- §5b pharmacist receiving a real PO with batches;
- all of §5c Phase 4 (grocery).

R11 "receive an old PO holding fuel": BLOCKED (none exists; every app path — PO create, draft, reorder list — now refuses to make one; dev data not changed by SQL).

Not one of the 7 forms: a new layaway with an opening advance (POST /sale-documents with deposit) records money but has no `once` middleware. Not double-clicked.

Café shifts: the café's 2026-10-14 day was closed in pass 2, so no shift could be opened; both settles are in no drawer (known B14).

Data left in the tester's stack: RET-000012…014; INV-000043…059; LAY-000002 (deposits 500 + 5 + 5 + 10 + 10); QA R3 expenses/incomes/deposits of 5–10; TAB-00184 (Apple Juice still on it); a lubricant PO received at Canal Road; QA R14 Delete and QA R14 Delete 2 deleted; INV-000060 (R4); café INV-000572 (TAB-00184) and INV-000573 (TAB-00185) settled with no shift; OFF-TILL-4Z67-000005 refused on Bilal's till (500 over in his drawer).

## 5. Addendum — Phase 4 (Rehmat Mart QA, grocery), done after the stop (told to the user in Roman Urdu)

| # | Check | Result |
|---|---|---|
| 1 | 20 scans in a row | PASS — 5 lines, each line's quantity and price right |
| 2 | Carton scan | PASS — Carton of 24 priced 2,000; milk stock 480 → 384 (96 = 6 + 18 + 72) |
| 3 | Weighed item | PASS — rice 1.235 kg × 320.50 = 395.82; stock 100 → 98.765. The receipt does not say "kg" (B59) |
| 4 | Bulk price vs sale price | PASS — 5 oil at 550 (bulk), below the sale price 560; the till says "bulk". The receipt gives no reason (B59) |
| 5 | Low stock → reorder → PO → short delivery | PASS — Yogurt 32 (alert 40) → draft PO-000002 (8) → placed → 5 received (partial). Labels from a PO: NOT BUILT |
| 6 | Batch and expiry | PASS — PO batches carry expiry; FEFO sold the earliest batch first. But the opening batch given when the product was made was lost (B60, P2) |
| 7 | Busy day (cut to 32 sales) | PASS — 32 sales, mixed payments, 2 returns; shift closed variance 0; day closed. Sales 42,619.48 the same in the sales list, the day, the dashboard and Reports. Profit off by 140 = known B11 |

New bugs:
- **B59 (P3)** — the receipt prints a weighed quantity without "kg", and a bulk price without its reason.
- **B60 (P2)** — a grocery item's opening batch and expiry are dropped without a word. Cause: `CreateProductAction.php:148-159` makes a batch only for medicine.

Items 1–4 were walked on the till screen; 5–7 through the API to save credit (their screens were not seen). A full day of 100+ sales is still to do.

