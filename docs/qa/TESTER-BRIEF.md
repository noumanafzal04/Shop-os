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

## 5. Pass 2 — what to test now

### 5a. Re-test what was fixed (do this first)

Fixed in backend `e14bf9e`, panel `db44390` (pushed 2026-10-14) — pull at least these. Clothing shop, tax 18 % inclusive, shift required.

| R | Bug | Steps | Expected |
|---|---|---|---|
| R1 | B02 | Manager **with an open shift** (note its expected cash). Sell a 3,900 item for cash. Sales → that sale → Exchange → hand back the 3,900 item → replacement 1,200 item. | The sheet says **"Hand back in cash Rs 2,700"**. Complete → 201. New sale: total 1,200, `change_due` 2,700. That person's drawer expected cash goes DOWN by 2,700. Stock: the returned item +1, the replacement −1. Cashbook/day agree. |
| R2 | B02 | Same, but an even swap and a dearer swap (+ cash). | Still work as before (no regression): even → nothing changes hands; dearer → the difference collected. |
| R3 | B01 (part) | Shift supervisor **with no shift** in a shop with a till: Sales → a cash sale → Return / Refund; and Exchange where money is handed back or taken in cash. | BEFORE pressing: a warning "You have no shift open" (`data-testid="refund-no-drawer"` / `"exchange-no-drawer"`). After: the answer carries `meta.warnings`; the return's `cash_session_id` is null. NOT expected yet: the money landing in the cashier's drawer (that is TO BUILD). A person WITH an open shift sees no warning. |
| R4 | B06 | Stock keeper (stock-keeper set only) → Purchase orders → a placed PO → "Receive all → stock in", and "Receive with details…". | 200; stock up; cost lands. Still refused (403, and not offered on screen): raising a PO, paying a supplier. |
| R5 | B05 | Manager → Purchase orders → + New → search a sized design. | Each size is offered as **"Name / Size"** with its cost (the size's own cost, else the design's). Plain items as before; packs only for plain items. Inactive sizes not offered. The order saves one line per size. |
| R6 | B05 | Via API: POST a PO line for a sized design with no `variant_id`. | 422 `VARIANT_REQUIRED` at creation (not at receipt). |
| R7 | B05 | Inventory → reorder list → draft orders, with a sized design on the list (alone, and with plain items). | Plain items drafted; the sized design is NOT drafted and is named: "Not included, because they are sold in sizes — order them size by size". Only sized items → 422 with that message. |
| R8 | — | Receive a by-size PO with one size set to 0. | That size stays outstanding; the others land with their cost. (Phase 0 fix, by hand.) |
| R9 | L1 | A PO part-received, then "Cancel the rest". | The cancel prompt says what arrived stays owed. Supplier still owes the received amount; Suppliers → account, Pay sheet and the purchases report all count what was KEPT (received), not what was ordered and not 0. |
| R10 | B13 | Suppliers → Pay, against a part-received PO; pay part. | "due" = received − paid; "Still owed after this" is right; the account after saving matches. A PO with nothing due is not offered. |
| R11 | B22 | Purchase orders list and detail. | Order date in the shop's own date format, not ISO. |
| R12 | B29 (part) | Customers → a khata customer → record a payment. | The customer's detail is asked once after saving, not twice. |

### 5b. Phase 1 — what pass 1 did not reach

- **Storefront order, customer side**: open the shop's storefront, order as a customer (delivery + COD, and pickup), then the shop accepts → dispatches → delivered/completed. Prove: the order and the sale agree (lines, sizes, price incl. sale price, delivery fee), stock of that SIZE down once, the customer record, the channel, the dashboard/sales list/reports. Tax 0 and channel are B17 — only note if different.
- Anything in the Phase 1 list you marked FAIL because of a bug now FIXED: walk it again end to end (items 2 and 4).

### 5c. Then the next phase — one phase per pass

Do **Phase 2** in this pass if there is room; otherwise it is pass 3. After that, one per pass in this order: 3, 4, 5, 6, 7, 8, 9, 10, 11. (Phase 12 is the release run — only when the fixer says.)

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
