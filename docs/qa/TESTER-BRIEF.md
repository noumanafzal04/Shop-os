# Tester brief — you test, you never fix

**Paste to the tester session:** "Pull the three branches. Read `docs/qa/TESTER-BRIEF.md`,
then `docs/qa/BUGS.md`, then `docs/qa/SYSTEM-TEST.md` sections 1–2. Do the next pass this
brief names. Change no code. End with the report file of section 7."

Two Claude Code sessions share this work (the user's call, 2026-10-14):

| | Tester (cloud session) | Fixer (local session) |
|---|---|---|
| Does | runs the app as the real people would, proves every figure, writes a report | fixes, adds a test that fails without the fix, runs the five gates, pushes |
| Never | changes code, commits code, "quickly fixes" something, reports a known bug again | tests by guessing; marks a bug FIXED without a commit |
| Hands over | one report file per pass, to the user, who gives it to the fixer | a push + `BUGS.md` statuses + a log line in `SYSTEM-TEST.md` naming what to re-test |

## 1. Rules

- **Test only.** If you find the cause, write `file:line` and a fix direction; the fixer fixes.
- **Nothing on live** — `panel.cartze.shop`, `cartze.shop`, `159.223.78.102`. Your own stack only.
- **No secret in any file** — no token, key or password. Logins in your report are the ones you made in your own stack.
- **HR is out** (Basic HR, attendance, biometric, payroll): do not test it, do not report it.
- **No roles, only permissions.** Cashier, manager… are sets in `backend/app/Support/StaffPresets.php`. Test what the permission allows.
- **Test the pushed code only** — the commits named in the newest line of the log in `SYSTEM-TEST.md` §7. Write the three commits you tested at the top of your report.
- Results are PASS · FAIL · BLOCKED (by what) · NOT BUILT · NOT TESTED. Priorities P0–P3 as in `SYSTEM-TEST.md` §2.

## 2. Your stack

Repo `github.com/noumanafzal04/Shop-os`, three branches: `main` (docs), `offline/v1/backend`, `offline/v1/admin-panel`.
Same as pass 1: PHP 8.4, MySQL 8.4, `php artisan migrate --seed`, panel `npm run dev` with its `.env` pointing at your backend; the platform admin is the seeded one in your stack.
After pulling new code: `composer install`, `php artisan migrate` (never `migrate:fresh` on a DB you still need), `npm ci` in the panel.
If your container lost the clothing shop, make it again exactly as pass 1 (settings in `BUGS.md`, "Pass 1").

## 3. How a check is proven

Five ways, every time (`SYSTEM-TEST.md` §2): the screen says it (also after a reload) · the status code · the stored value read back from the API to the paisa · everything that follows agrees (stock, khata, cashbook, drawer, day, reports, dashboard) · nothing else happened (0 console errors, no stray 4xx/5xx, no request twice in one step, nothing slower than 1.2 s).
Tool: `panel/e2e/qa-kit/kit.mjs` (`open(email)` → `{page, step, shot, ask, report, close}`), e.g. `BASE=… API=… node e2e/qa-kit/p1-returns.mjs`.

## 4. Do not report again

Every bug in `BUGS.md` with status **OPEN**, **PART**, **OWNER** or **TO BUILD** is known. Do not file it again.
If a known one behaves DIFFERENTLY now (worse, better, other figures), put one line under "Known bugs that changed" in your report.
Owner decisions already taken are in `BUGS.md` → "Owner's answers"; their changes are not built yet — do not report today's behaviour of them as a bug.

## 5. Pass 6 — what to test now

Passes 1–5 are in `BUGS.md`. **From 2026-10-15 the local session also tests** (the cloud tester's credits ran
out); this section is kept so any tester — or a new chat — can pick up. Pull the newest backend and
panel, docs (newest `main`). Run `php artisan migrate` (three new: `sale_returns.approved_by/approved_at`,
`products.for_sale`, `supplier_payment_allocations`).

### 5a. Re-test what was fixed (do this first)

| R | Bug | Steps | Expected |
|---|---|---|---|
| R1 | B01 | Cashier (no `sales.refund`) returns a cash sale at their own till. Then a supervisor with no shift refunds a sale, choosing the cashier's open drawer. Then a wrong PIN; then a drawer at ANOTHER place. | Cashier: the sheet asks "Approved by" + PIN; Refund stays shut until both are given; the cash comes out of the cashier's drawer; `approved_by` = the supervisor; an audit row `approved`. Wrong PIN: "That PIN is not right." (locks after the usual tries). Another place's drawer: refused. |
| R2 | B11 | Sell, return part of it, read Dashboard profit and Reports profit for today. | The same figure. |
| R3 | B12 | First purchase of a SIZE with stock already on the shelf. | The size's cost is the weighted average, not the new price. |
| R4 | B32 | Reorder list → draft for an item last bought as a box of 5. | The draft line is priced per PIECE (box price ÷ 5). |
| R5 | B33 | Pay a supplier naming a cancelled order that took a delivery; then one that took nothing. | First 201 and the order's `amount_paid` rises; second 422 PO_NOT_PAYABLE. |
| R6 | B52 / B27 | Exchange: hand one back, pick a replacement. Open Take order. | No `/sales/worth` or `/orders/worth` with `items: []`; no 422; no console error. |
| R7 | B53 / B58 | Dashboard (Simple) as stock keeper, buyer, kitchen; with orders waiting. | No grey pills that never fill; nobody without Orders is told to accept orders; nobody not sent the sales is told "nothing rung up yet". |
| R8 | B54 | Fuel station: petrol and an engine oil below their alert levels → Needs reordering → Order these. | Petrol's row says "Comes by tanker"; the button counts the oil only; the oil's draft is made. A list of petrol alone: 422 FUEL_COMES_BY_TANKER. |
| R9 | B55 | Any staff without settings.manage: GET /auth/me and /shop. Owner the same. Admin: /admin/tenants/{id}. | Staff: no `plan.price`, no `package`; `subscription_state` still there. Owner and admin: both present. |
| R10 | B56 | A cashier types /tenant/subscription. | Sent to the dashboard; no request to /shop/subscription; no 403; no console error. |
| R11 | B57 | Offline: ring a sale, delete its product on the server, reconnect, open "See which". | The refused row shows the sale's amount, not "amount unreadable". (Rows queued by an older build may still say it.) |
| R12 | B59 | Sell rice weighed 1.235 kg and 5 oil at a bulk rate; print the receipt. | "1.235 kg"; "Bulk price, 5 or more" on the oil; nothing on 4 bottles at the shelf price. |
| R13 | B60 | Grocery: add a yogurt with opening stock 24, a batch number and an expiry. | One lot with that number, expiry and 24; FEFO and the expiring list see it. Without either: no lot. |
| R14 | B61 | Pharmacy: Receive with details, leave one medicine line's expiry empty. | Receive stays shut; that line says the expiry is needed. |
| R15 | B62 | Café: an ingredient with "Sold to customers" off, in a dish's recipe. Till search, a table's menu, Take order, storefront; a sale/tab/order/quote naming it; sell the dish. | Offered nowhere; every way of selling refused NOT_FOR_SALE by name; the products list says "Not sold — ingredient"; selling the dish still takes the ingredient off the shelf. |
| R16 | B07 shape | Double-click: park as layaway WITH an advance; Bill & hand over; Take order; storefront checkout. | One record each (the key is kept from the first press). |
| R17 | L4 | A shop with "Require open shift" on. (a) No shift: till, tab settle, New Sale (walk-in), exchange, Bill & hand over. (b) A shift opened on an EARLIER day: the same five. (c) Close it, open today's, sell. (d) A phone order with no shift. | (a)(b) The till's red strip says why with Open / Close shift; Pay shut; the other four show the note and a shut button; the API answers 409 SHIFT_REQUIRED / SHIFT_FROM_AN_EARLIER_DAY. (c) Sells, on the new shift, in today's day. (d) Not refused. A shop with the setting off: amber strip, still sells. |
| R18 | L5 | Close shift, typing nothing; then tick "The drawer is empty"; then a real count. | Nothing typed: Close shift shut, "Count the drawer first." Ticked: closes at 0, short by what was expected. Counted: closes with the right variance. |
| R19 | L6 | Reports, a custom range of 2+ days with sales at a cost, a return and an expense. | Each day's `series[].profit` = that day's revenue − refunds − tax − cost of goods + other income − expenses, equals the dashboard's day, and the days add up to `totals.net_profit`. |
| R20 | L2 | A shop that requires shifts, someone with no shift: hold goods on advance with CASH (till F7 and the Quotations screen); then Card. Take an instalment in cash on an open advance. Then open today's shift and take cash. | Cash: the form says "Open a shift to take cash …" and its button is shut; the API answers 409 SHIFT_REQUIRED "Open a shift before taking cash." Card: goes through. With today's shift: the cash lands in that shift's drawer (`deposit_in`). |
| R21 | paper | A shop with receipts on 80mm: save a quotation at the till; print it again from its page; change Settings → Receipt → "Quotations & advances print on". | The till prints it on A4 without asking. Its page's Print asks with A4 picked; 58mm prints that copy on 58mm and Settings is unchanged. After the setting changes, both follow it. |
| R22 | L7, L8 | A customer on file as "0300-1234567". At the till type "03001234567"; on a quote "+92 300 1234567"; add a customer "0300 1234567". Then type three letters of their name in the till's Customer box and on the quotation form. | One customer throughout (khata, points, quotes); the new customer is refused, naming who has the number. Both boxes list them under "Already on file"; a tap fills name and number; a cashier without the customers permission sees the same. |
| R23 | L9 | A supplier with two delivered orders. Pay part of the first naming it (cash); then pay on account (bank, with a reference) more than the first still owes. Open each order; open Suppliers → History. As a stock keeper, open an order. | Each order: Ordered, Arrived, Paid, Left; every payment with its date, method, reference and its share ("part of a Rs X payment" for the split one); the lines add up to Paid. History: the on-account payment lists both orders and their shares; the orders show bill / paid / left. The stock keeper sees no payments. |
| R24 | L10–L12 | A shop with an online store: Add item with stock, barcode, no description. Then open the item and switch "Still selling this" off AT ONCE, save; open it again and switch it on, save. Open its stock movements. | The first save says it needs a description with two buttons; "Sell it in the shop only" lets it save. The form is covered until the item loads; the switch saved is the switch shown (list Inactive, till "No item found"; then Active, scans). The history's first line is "Opening stock" in, with the quantity. |

### 5b. What no pass has reached yet

Screen walks for waiter, pharmacist, forecourt attendant and purchasing (menu + every screen typed in; no 403 or
console error on an opened screen); a 100+ sale day (mixed tenders, 2 returns, shift + day closed; list = day =
dashboard = reports); Phase 5 restaurant (rest), Phase 6 pharmacy, Phases 7–11 — see §6.

Known and not to be re-reported: everything OPEN / PART / OWNER / TO BUILD in `BUGS.md`, B47 (waiting on Q10).

## 6. The phases in detail

### Phase 2 — Who may do what

Make one staff member per set (Staff → add → choose the set) in the clothing shop; for the restaurant, pharmacy and petroleum sets use a shop of that trade (Phase 5/6/7) or say BLOCKED.

| Set | Has | Must be ABLE to | Must be REFUSED (screen hidden AND API 403) |
|---|---|---|---|
| Cashier | sales.manage, discounts.apply, customers.manage, tables.serve_any | sell, discount up to the shop's ceiling, add a customer, take a khata payment | refund, void/cancel a sale, discount past the ceiling, cost/profit/margin, purchases, suppliers, expenses, reports, settings, staff |
| Shift supervisor | cashier + sales.void, sales.refund, discounts.override, reports.view | everything a cashier can, plus refund, void, discount past the ceiling, read reports | purchases, suppliers, expenses (writing), settings, staff |
| Waiter | sales.manage, customers.manage | own tables: open, order, send to kitchen, settle | another waiter's table, refund, void, reports |
| Kitchen | kitchen.manage | kitchen board, mark ready | the till, takings, everything else |
| Stock keeper | products.manage, inventory.manage | products, stock, adjust, stocktake, transfers, RECEIVE a PO | raise a PO, pay a supplier, sales money, profit, expenses |
| Purchasing | suppliers.manage, purchases.manage, products.manage, inventory.manage | suppliers, raise/receive/cancel POs, pay suppliers | the till, refunds, expenses, reports |
| Online orders | orders.manage, products.manage, customers.manage | accept → dispatch → complete orders, listings | the till's refunds, purchases, expenses, reports |
| Accounts | expenses.manage, reports.view | expenses, income, cashbook, reports, profit | sell, touch stock, purchases |
| Forecourt attendant (petroleum) | sales.manage, customers.manage, inventory.manage | pump sales, own forecourt shift against the dip | tanker deliveries, price changes |
| Pharmacist (pharmacy) | sales.manage, discounts.apply, customers.manage, products.manage, inventory.manage | dispense, batches, expiry | refund, void, purchases, reports |
| Manager | almost all, incl. inventory.any_place, coupons, reservations, orders | run the day: sales, stock at any place, money, reports | staff, shop settings, billing |

For every set also check:
- [ ] The menu shows only what the set allows; a hidden screen typed into the address bar does not open (and does not quietly show the dashboard as if it were the page).
- [ ] The API refuses the same things directly (403) whatever the screen shows — call each write endpoint as that person.
- [ ] Money: cost price, profit, margin, supplier balances are NOT in the API answers to a person without the permission (not just hidden on screen). Dashboard Today's Profit/Expenses: null for cashier and stock keeper.
- [ ] A person tied to one place cannot read or move another place's stock (`inventory.any_place` is the only way).
- [ ] One shop against another: make a second shop; take a product/sale/customer/PO id from shop B and use it in shop A's requests (read, edit, delete) → 404/403, and shop B's record unchanged.
- [ ] Extra fields the form does not send (`tenant_id`, `cost`, `price` on a sale line, `status`, `branch_id` of another shop) → ignored or refused, never stored.
- [ ] A module switched off (owner → modules): its menu gone, its screens refuse, its API refuses, its old records still readable where they should be.
- [ ] A staff member switched off / deleted: their open session stops working at the next request.
- Known, do not report: applying a stock count is owner-only today (owner decided to change it — Q3).

### Phase 3 — Offline and sync, the hard cases

Offline needs the BUILT app: `npm run build && npm run preview` (or `npx playwright test e2e/offline-shift.spec.ts`, which builds and serves :4173). Cut the line with Playwright `context.setOffline(true)` or DevTools. Check BOTH the device and the server; each sale must arrive exactly once.
- [ ] The sale reached the server but the answer was lost → sent again → ONE sale.
- [ ] Two tills sell the last piece offline → what the server does; what each till shows after.
- [ ] Price changed on the server while offline → which price the offline sale keeps; the bill says so.
- [ ] Product deleted / switched off while offline → the sale still syncs or is refused clearly, never lost.
- [ ] Session expired / staff switched off while offline → sales kept, sent when someone signs in.
- [ ] Device storage full → clear message, nothing lost.
- [ ] Sign out with sales waiting → warned; nothing lost.
- [ ] Same device, another shop signs in → the first shop's catalogue and waiting sales never shown or sent to it.
- [ ] Refused at sync (bad data) → shown as failed, with a reason; can be fixed or removed.
- [ ] Offline sale of a SIZE: right size, right price (a size on sale → the sale price), right stock after sync.

### Phase 4 — A mart (grocery)

New shop: retail · grocery. Items: a single + a pack + a carton (each own barcode and price), a loose item sold by weight, an item with a wholesale price by quantity and a sale price.
- [ ] Fast scanning (20 scans in a row): the right line, quantity, price every time.
- [ ] Carton scanned → carton price, stock down by the carton's pieces.
- [ ] Weighed item: price × weight to the paisa; receipt says the weight.
- [ ] Wholesale tier vs sale price → the customer pays the lower; the bill says why.
- [ ] Low stock → reorder list → PO → receive (with a short line) → labels for what arrived.
- [ ] Expiry dates on a batch, if the shop keeps them.
- [ ] A busy day: 100+ sales (kit loop), mixed tenders, 2 returns; close the shifts and the day; the chorus.

### Phase 5 — Restaurant and café

- [ ] Waiter on a phone: table → order (sizes + questions) → kitchen ticket → kitchen screen → served → bill → split → paid.
- [ ] Recipe stock goes down by the ingredients; an "ingredient — not sold" item.
- [ ] Void after the kitchen has it; a dish refused; table moved; reservations.
- [ ] Delivery with a rider (rider app side: accept, deliver, COD); takeaway; café counter.
- [ ] Journey stages 41 and 42: `npx playwright test --project=journey`.
- Known, do not report: orders carry no tax; no promotions on orders; reservations ≠ tables (waiting on the owner).

### Phase 6 — Pharmacy

New shop: pharmacy.
- [ ] Batches with expiry; FEFO (the soonest expiry sold first); an expired batch refused at the till.
- [ ] Near-expiry list; return to supplier; disposal of expired stock — stock and money follow.
- [ ] Prescription items, if the trade has them. Pharmacist set's permissions (Phase 2 table).

### Phase 7 — The other trades, one pass each

Services · automotive / workshop · petroleum (forecourt) · wholesale (distributor) · online store · books-only (finance) · a shop that trades in dollars.
For each: make the shop (admin), check its default modules, do its main flow once by hand, ask the chorus question ("how much was sold today, and what is left of item X?") of every screen.
- Dollar shop: no "Rs" anywhere on its screens, receipts, reports; its currency cannot be changed once it has traded.
- Books-only: no till, no stock screens; money in/out and reports work.

### Phase 8 — Platform admin, plans, billing

- [ ] Make a shop of each type; the plan decides its modules; changing the plan changes what the shop sees (menu + API).
- [ ] Suspend / resume; a lapsed shop can read but not write (403 on writes, clear message); grace period.
- [ ] Record payments for three months (incl. a blank amount, a 31st); the period bar; collected = the ledger total.
- [ ] Commission; announcements and banners reach the shop.
- [ ] Admin staff permissions (an admin without a permission is refused on screen and API).

### Phase 9 — Bad network, errors, security

- [ ] Slow network (throttle): no button double-submits; Pay twice = one sale; every money form (khata payment, supplier payment, expense, income, deposit, exchange) — B07 is known for three of them, test the rest.
- [ ] Server 500 / 503 mid-sale (route interception): nothing half-saved; a clear message.
- [ ] 401 mid-work (token removed): back to sign-in; work not lost.
- [ ] 429 (sign in 6× in a minute; API over 240/min): the screen waits and says so.
- [ ] XSS: a product/customer name with `<script>` / `<img onerror>` shows as text on screens, receipts, labels.
- [ ] Uploads: a non-image as a product photo, an over-size file → refused clearly.

### Phase 10 — Volume and speed

- [ ] `php artisan loadtest:shops`, `loadtest:audit` (every check passes), `loadtest:timings` — p50 / p95 per screen.
- [ ] Requests per reload per screen (HAR): nothing asked twice (B29 is known — list the others).
- [ ] A till with thousands of products offline: open time, search time.

### Phase 11 — Phone, tablet, keyboard

- [ ] Playwright projects `phone`, `tablet-portrait`, `tablet-landscape`, `restaurant-phone` on the pushed code; report each failure with its screenshot path.
- [ ] By hand at 390 px: no page scrolls sideways; buttons reachable; the till's totals and its one button along the bottom.
- [ ] The till by keyboard only (F-keys); every form field has a label.

## 7. The report — what you hand back

One file per pass: **`TESTER-REPORT-<yyyy-mm-dd>-<what>.md`** (e.g. `TESTER-REPORT-2026-10-15-retest-and-phase-2.md`).
You cannot push to the repo (GitHub answered 403 to this session), so keep the file in the session and tell the user it is ready; the user gives it to the fixer.

In this order:

1. **Header** — commits tested (backend, panel, docs), stack, shops and people used, how (UI / API).
2. **Summary for the fixer** — keep it to one screen:
   - re-test table: `R | bug | PASS/FAIL | one line` (every R in §5a);
   - new bugs table: `ID | P | area | one line` (IDs from "next bug" in `BUGS.md`);
   - "Known bugs that changed" (one line each, or "none");
   - new questions for the owner (`Q6…`, or "none");
   - the phase checklist with PASS / FAIL / BLOCKED per item.
3. **Each new bug** — who and which screen · steps · expected · actual · proof (invoice/PO numbers, figures, status code, the request) · cause `file:line` if found · fix direction (NOT done).
4. **Not tested, and why.**

## 8. How the loop runs

1. The fixer pushes and writes a log line in `SYSTEM-TEST.md` §7: the three commits, and which bugs to re-test.
2. The user tells the tester "next pass". The tester pulls the three branches at those commits, reads `BUGS.md`, re-tests every bug marked FIXED since its last pass (an R-table like §5a — the fixer adds it to §5 of this brief), then tests the next phase.
3. The tester hands its report to the user; the user gives it to the fixer.
4. The fixer copies new bugs into `BUGS.md` (same IDs), fixes P1 first, marks each FIXED `<commit>`, rewrites §5 of this brief with the next re-test list and the next phase, pushes — and the loop starts again.

Neither session tests code the other is still changing: the tester always tests the commits in the newest log line.
