# System test, phase by phase — start here

**For a new chat:** "Read `docs/qa/SYSTEM-TEST.md`. Follow its rules. Continue
from the first phase that is not PASS. After every thing you test, add a line
to the log at the bottom of this file."

**Since 2026-10-14 testing and fixing are split:** a tester session (cloud) only
TESTS, from `docs/qa/TESTER-BRIEF.md`, and hands back a report; the fixer
session (local) fixes. Every bug, its status and the owner's answers live in ONE
list: `docs/qa/BUGS.md`.

The whole system is NOT tested in one go. One phase per session; a phase ends
with its checklist ticked, its bugs fixed (or written down), and the log updated.

Older guides this file builds on (read only when a phase points to them):
`FULL-TEST-FLOW.md` (layers and gates), `QA-SWEEP-RUNBOOK.md` (cross-trade
sweep), `TRADE-DAY-PLAN.md` (one day per trade), `journey/CASES.md` + `journey/RUNS.md`
(the Playwright journey and its run list).

---

## 1. Rules

| Rule | Why |
|---|---|
| Nothing on live (`panel.cartze.shop`, `cartze.shop`, the droplet). The user deploys. | Real shops. |
| Dev data (`shopos` DB) is made and changed only through the app (screens or API). Never SQL, never `migrate:fresh`. `shopos_test` is the only DB a test may wipe. | The user tests on the same DB. |
| Do not stop the user's servers: backend `:8000`, panel `:5177`. (`:5173`, `:5180` are other projects.) | They are testing by hand. |
| Changing code while the user tests or a suite runs → change a copy (backend `:8001`, panel `:5198`) and land it later. | A half-made change must not reach their screen. |
| **HR is out**: Basic HR module, attendance, biometric, payroll — do not test, do not build. | Not in this version. |
| There are no roles, only permissions. Cashier, stock keeper, manager… are permission SETS (`backend/app/Support/StaffPresets.php`). Test the permission, not the name. | A role check would be the wrong fix. |
| Never run phpunit / the whole vitest / a build beside a Playwright suite. | They fight for the machine and fail for no reason. |
| `./vendor/bin/pint <changed files>` — never the whole repo. No currency mark (Rs/PKR) in a PHP/TS file. Never rename `shopos-*` storage keys. Never format a date the browser's way. | Standing guards in the code. |
| No secret in a commit (tokens, keys, passwords). Scan the diff before every commit. | The repo is public. |
| Push only when the user asks, and only after all five gates pass (section 3). | A broken build would go live. |

## 2. How a check is proven

A page that opens is not a PASS. Each thing tested is proven five ways:

| What | How |
|---|---|
| The screen says it | what the person sees after the action (and after a reload) |
| The server took it | the status code is the expected one (2xx — or the 403 / 422 the case expects) |
| It is stored as typed | ask the API again (`qa.ask`) — every field read back, every figure to the paisa |
| Everything that should follow did | stock, khata, cashbook, drawer, reports, dashboard all say the same figure ("the chorus") |
| Nothing else happened | 0 console errors, no unexpected 4xx/5xx, no request repeated in one step, nothing slower than 1.2 s (`qa.report()`) |

Offline: after the line comes back, check BOTH the device and the server, and
that each sale arrived exactly once.

**Results** are one of: PASS · FAIL · BLOCKED (say by what) · NOT BUILT · NOT TESTED.

**A bug:** write it in the log with a priority —
P0 data loss / one shop sees another / money or stock counted twice ·
P1 a core flow broken, wrong money/stock/tax, a permission bypass ·
P2 a module or sync defect · P3 looks, words, speed.
Fix the smallest thing, add a test, and prove the test FAILS when the fix is
taken out (mutation) — then run it again green.

## 3. Tools and commands

**The hand-QA kit** — `panel/e2e/qa-kit/kit.mjs` (one person, one browser, every
API call recorded). Copy `example-walk.mjs`, name it after the phase, then:

```sh
cd panel
node e2e/qa-kit/p1-returns.mjs                                  # against :5177 / :8000
BASE=http://localhost:5198 API=http://localhost:8001/api/v1 node e2e/qa-kit/p1-returns.mjs   # against a copy
```

`open(email, {password, stage})` → `{page, step, shot, ask, report, close}`.
Shots, HAR files and saved sign-ins go to `panel/test-results/qa/` (not committed).
Sign-in allows 5 a minute; the API 240 a minute per person; a session lasts 60 minutes.

**Playwright** (from `panel/`; the projects are in `playwright.config.ts`):

```sh
E2E_BASE_URL=http://localhost:5177 E2E_API_URL=http://localhost:8000/api/v1 npx playwright test --project=desktop
npx playwright test --project=journey          # one business from empty, stage by stage
npx playwright test e2e/offline-shift.spec.ts  # offline needs the BUILT app: leave E2E_BASE_URL unset (it builds and serves :4173)
```

Other projects: `tablet-portrait`, `tablet-landscape`, `phone`, `restaurant`,
`restaurant-tablet`, `restaurant-phone`, `admin`, `storefront`, `doors`,
`print-window`, `volume*`.

**The five gates** (all must exit 0 before a push):

```sh
cd backend && php artisan test; echo "exit=$?"
cd panel && npx vitest run; echo "exit=$?"
cd panel && npm run build; echo "exit=$?"
cd panel && npx eslint .; echo "exit=$?"
cd panel && npx tsc -p tsconfig.e2e.json --noEmit; echo "exit=$?"
```

Judge by the exit code, not the summary line.

**Volume:** `php artisan loadtest:shops` (seed 9 load-test shops) ·
`php artisan loadtest:audit` (every figure worked out a second way) ·
`php artisan loadtest:timings` (screen times).

## 4. Shops and logins (dev DB only — none of these exist on live)

| Shop | Login | Notes |
|---|---|---|
| **Zari Clothing** — retail, garments, plan Pro, all 21 modules | owner `sana@zariclothing.test` / `Zari-pass-1` · staff `bilal@` cashier, `usman@` stock keeper, `farah@` accounts, `hina@` manager — all `@zariclothing.test` / `Staff-pass-1` | Made by hand 2026-10-13; 9 sales; two shifts left OPEN (Sana float 5,000, Bilal 2,000). Its dashboard shows tables and kitchen because every module was given — expected. |
| Sweep Mart (grocery) | `sweep-mart@qa.test` / `password` | Used by the desktop Playwright project. Paid to 2026-11-10. |
| Sweep Food Restaurant | `sweep-food-restaurant@qa.test` / `password` | Restaurant projects. Paid to 2026-11-10. |
| Sweep pharmacy / petroleum / automotive / … | `sweep-<trade>@qa.test` / `password` | Lapsed: their writes answer 403 until extended. |
| Platform admin | ask the user | Not written here — this repo is public. |

## 5. The phases

| # | Phase | Status |
|---|---|---|
| 0 | Decisions A–D | PASS (built 2026-10-13; gates before push) |
| 1 | A clothing shop's whole life (Zari) | PART — tester pass 1 done (B01–B30 in `BUGS.md`); 6 fixed + pushed (`e14bf9e` / `db44390`); re-test + leftovers = tester pass 2 |
| 2 | Who may do what | PART — tester pass 2 (B31–B46); its P1s fixed in `5e2bcf6`/`3835cbb`; leftovers in TESTER-BRIEF §5b |
| 3 | Offline and sync, the hard cases | PART — tester pass 3 (B47–B51); B48 fixed in `5e2bcf6`/`3835cbb`; B47 waits on Q10; storage-full BLOCKED headless |
| 4 | A mart (grocery) | NOT TESTED by hand |
| 5 | Restaurant and café | PART — stages 41/42 owed |
| 6 | Pharmacy | NOT TESTED by hand |
| 7 | The other trades, one pass each | NOT TESTED by hand |
| 8 | Platform admin, plans, billing | NOT TESTED by hand |
| 9 | Bad network, errors, security | NOT TESTED |
| 10 | Volume and speed | NOT TESTED this month |
| 11 | Phone, tablet, keyboard | NOT TESTED against the latest code |
| 12 | Full regression, then release | — |

Order matters: money and stock first (0–3), then each kind of shop (4–7), then
the platform (8), then the hard edges (9–11), then everything once more (12).

### Phase 0 — Decisions A–D (the user answered 2026-10-13) — PASS

Built and proven; full record in `docs/decisions/shopos-four-answers-from-the-owner.md`.
Walk scripts: `panel/e2e/qa-kit/p0-cashier.mjs`, `p0-owner.mjs`.

- [x] **A — a size on sale.** The bill charges the chosen size's selling price, and the list, till tile and bill say the same figure. *Answered by the user 2026-10-13:* a size with its own price → that price; a size WITHOUT its own price → the design's selling price, sale included (4,990, not 5,490). Today `Product::sellingPrice()` never discounts a size.
- [x] **B — profit and expenses.** Today's Profit and Expenses on the dashboard only for people with a permission for it (given to the owner, manager and accounts sets; not cashier or stock keeper). Checked by the SERVER — the figure must not even be sent.
- [x] **C — old costs.** Fill `sale_items.unit_cost` for sized lines sold before the fix ONLY from a recorded purchase or stock movement for that size. No record → stays unknown, and the margin report says so. Never guessed.
- [x] **D — hold label.** The hold label names the ticket only. The sale's customer is set only when a customer is chosen.
- Done when: each has a backend test and a panel test that fail with the fix taken out, and Zari shows the right figures by hand. ✔
- Found on the way and fixed: a receipt that left a line out (a size set to 0) booked that line in full.
- Before running C on live: deploy, note the time, run `php artisan shopos:size-costs-from-purchases --until="<that time>"` WITHOUT `--apply`, read the list, then add `--apply`.

### Phase 1 — A clothing shop's whole life (Zari)

Day one (made, stocked, sold, offline) is done — see the log. Still to walk, as
the person who would really do it:

- [ ] Return a size for cash: refund figure shown BEFORE the press; stock of that size back; drawer, cashbook, sale, report agree.
- [ ] Exchange one size for another (dearer and cheaper): the difference paid / given back; both sizes' stock right.
- [ ] Khata: sell on credit, take part payment, take the rest; customer balance, khata page, cashbook agree.
- [ ] Purchase order raised by the manager, received by the stock keeper (`usman@`) at a chosen place; cost per size lands; supplier owed; pay the supplier. Include a size that did NOT arrive (set to 0) — fixed in Phase 0, check it by hand.
- [ ] Move stock between two places; sell from the second; both balances right.
- [ ] Expenses and income with categories; cashbook and reports show them.
- [ ] Close both open shifts (counted cash vs expected), then close the day; day report = sum of the day.
- [ ] Coupon, promotion and bank card offer at the till; the receipt and the report show the discount.
- [ ] Quote → advance → turned into a sale.
- [ ] Barcode labels for sizes; stocktake with a difference; a disposal.
- [ ] Phone / online order taken and delivered.
- [ ] The chorus: one question ("how much was sold today, and what is left of design X size M?") asked of every screen that answers it — all agree.

### Phase 2 — Who may do what

For each staff set in `StaffPresets.php` (Cashier, Shift supervisor, Waiter,
Kitchen, Stock keeper, Purchasing, Online orders, Accounts, Forecourt attendant,
Pharmacist, Manager):

- [ ] The menu shows only what the set allows; hidden screens refuse when typed into the address bar.
- [ ] The API refuses the same things directly (403), whatever the screen shows.
- [ ] Money and cost: cost prices, profit, supplier balances not sent to those without the permission.
- [ ] Refund, void, discount above the limit, price override — each refused without its permission, allowed with it.
- [ ] `inventory.any_place` and the place walls: a person tied to one place cannot read or move another place's stock.
- [ ] One shop against another: swap an id from shop B into a request from shop A (read, edit, delete) → 404/403, nothing changed.
- [ ] Sending fields the form does not have (`tenant_id`, `cost`, `price` on a sale line, `status`) → ignored or refused.
- [ ] A module switched off: its screens gone, its API refuses, its old records still readable where they should be.

### Phase 3 — Offline and sync, the hard cases

Already PASS (2026-10-13): new product reaches the device in seconds, list,
search, scan (plain and size), unknown tag, two offline sales, tab closed,
line back → synced once, stock down. Still to do:

- [ ] The sale reached the server but the answer was lost → sent again → ONE sale.
- [ ] Two tills sell the last piece while offline → what the server does, what each till then shows.
- [ ] Price changed on the server while the till was offline → which price the offline sale keeps, and the bill says so.
- [ ] Product deleted or switched off while offline → the sale still syncs or is refused clearly, never lost.
- [ ] Session expired / staff switched off while offline → sales kept and sent when someone signs in.
- [ ] Device storage full → a clear message, nothing lost.
- [ ] Sign out with sales still waiting → warned; nothing lost.
- [ ] Same device, another shop signs in → the first shop's catalogue and waiting sales never shown or sent to it.
- [ ] Refused at sync (bad data) → shown as failed, with a reason, and can be fixed or removed.

### Phase 4 — A mart (grocery)

- [x] Fast scanning; a pack and a carton (own barcode, own price); loose / weighed items. — PASS (tester pass 4 addendum, Rehmat Mart); the receipt's missing "kg" was B59, fixed.
- [x] Wholesale price tiers by quantity vs a sale price — the customer pays the lower. — PASS; the receipt now names the bulk rate (B59).
- [~] Low stock → purchase order → receive → labels. — PASS to a short delivery (API only); labels from a PO are not built.
- [x] Expiry dates on a batch, if the shop keeps them. — PASS (FEFO); the opening lot was dropped (B60), fixed.
- [~] A busy day (100+ sales) and the day close. — 32 sales (API): every figure agreed, profit 140 off = B11 (fixed). 100+ still to do.

### Phase 5 — Restaurant and café

- [ ] Stage 41 and 42 of the journey (owed).
- [ ] Waiter on a phone: table → order → kitchen ticket → kitchen screen → served → bill → split → paid.
- [~] Sizes and questions (modifiers) reach the kitchen and the bill; recipe stock goes down. — recipe stock PASS (pass 5: 3 sold 10 → 9.7, 1 back → 9.8); the rest still to do.
- [ ] Void after the kitchen has it; a dish refused; table moved; reservations.
- [ ] Delivery with a rider; takeaway; café counter.
- [~] Open questions first (section 6): orders untaxed, no offers on orders, ingredients sold. — "ingredient, not sold" BUILT (B62, 2026-10-15); the other two still open.

### Phase 6 — Pharmacy

- [ ] Batches with expiry: the oldest risk goes first (FEFO); an expired batch is not sold.
- [ ] Near-expiry list; return to supplier; disposal of expired stock.
- [ ] Pharmacist set's permissions.

### Phase 7 — The other trades, one pass each

Services · automotive / workshop · petroleum (forecourt) · wholesale (distributor) ·
online store · finance / books-only · a shop that trades in dollars.
For each: make the shop, check its default modules, do its main flow once by
hand, run its journey stage, and ask the chorus question.

### Phase 8 — Platform admin, plans, billing

- [ ] Make a shop of each type; the plan decides its modules; changing the plan changes what the shop sees.
- [ ] Suspend / resume; a lapsed shop can read but not write; grace period.
- [ ] Payments for three months; commission; announcements and banners.
- [ ] Admin staff permissions.

### Phase 9 — Bad network, errors, security

- [ ] Slow network: buttons do not double-submit; Pay twice = one sale.
- [ ] Server 500 / 503 mid-sale: nothing half-saved; a clear message.
- [ ] 401 mid-work (session ended): back to sign-in, work not lost.
- [ ] 429: the screen waits and says so.
- [ ] Headers, CORS, and `X-Shell-Stamp` exposed on the live nginx (check with the user).

### Phase 10 — Volume and speed

- [ ] `loadtest:shops`, `loadtest:audit` (all checks pass), `loadtest:timings` — p50 / p95 per screen.
- [ ] Requests per reload per screen (HAR): nothing asked twice.
- [ ] A till with thousands of products offline: open time, search time.

### Phase 11 — Phone, tablet, keyboard

- [ ] Playwright `phone`, `tablet-portrait`, `tablet-landscape`, `restaurant-phone` on the latest code.
- [ ] The till by keyboard only (F-keys); labels on every form field.

### Phase 12 — Full regression, then release

- [ ] Every Playwright project, the five gates, the offline specs on the built app.
- [ ] A release note: what passed, what failed, what was not tested, and why.

## 6. Waiting on the user

- (A answered 2026-10-13 — built in Phase 0.)
- 2026-10-14: B01 (cashier's drawer + supervisor PIN) and Q1–Q5 answered — `BUGS.md` → "Owner's answers". **Q4 is held:** it was answered as a staff salary advance; the question was a CUSTOMER's advance on a layaway, and payroll is out of this version.
- Restaurant: orders carry no tax; no promotions on orders; an "ingredient — not sold" item can be sold; are Reservations tables?

## 7. Log — newest first

Format: `date · phase · shop / who · what · how · result · bugs (commit) · not done`

- **2026-10-17 · money pass (Claude tester) · push** · report `docs/qa/TESTER-REPORT-2026-10-16-money.md` read; $1–$12 → B73–B84. Part 1 backend **`9d92b5f`**, panel **`a8f5182`** (B73 B74 B75 B82 B84); part 2 backend **`18c69b9`**, panel **`a01acfe`** (B79 B80 B81); part 3 backend **`57fdcb6`**, panel **`c799a2b`** (B76 B77 B78 B83-drawer). Every part: all five gates exit 0; each fix has a test that fails without it (mutation by exit code). Re-test R36–R46 (TESTER-BRIEF §5a). Not done: Q16 (delivery fee, B34/B83) waits on the owner; B65 to build.
- **2026-10-16 · Codex retail Part A, parts 2–3 · push** · B69 + B70 backend **`3009a8b`**, panel **`d61f53f`** (phpunit 3,963 / 3,941 · vitest 291 / 3,398 · build · eslint 0 errors · tsc-e2e); B71 + B72 backend **`aa660f4`**, panel **`f059d4a`** (phpunit 3,966 — one clock-dependent assertion found and fixed in the same commit · vitest · build · eslint · tsc-e2e); B72 measured at 390 px on the copy · left: B65 (owner's choice), L22.
- **2026-10-16 · Codex retail Part A + the user's inventory item · push** · Codex's report read (B63–B72 recorded); part 1 gated (phpunit 3,958 / 3,936 passed / 22 skipped · vitest 291 / 3,398 · build · eslint 0 errors · tsc-e2e) and pushed: backend **`c12de2a`**, panel **`d714e4f`** — B63, B64, B66, B67, B68, L21 · item-form stock entries checked on the copy (Opening +24 → 24, Stock in +6 → 30, sizes S/M each Opening) · B69, B70 fixed on the copy, next push · not done: B65, B71, B72, L22.
- **2026-10-16 · owner answers Q11, Q6, Q10 · push** · Q11 + Q6 backend **`a549989`**, panel **`95e4f48`** (gates: phpunit 3,943 / 3,921 passed / 22 skipped · vitest 290 / 3,379 · build · eslint 0 errors · tsc-e2e); Q10 / B47 backend **`0a4bf4b`**, panel **`02da955`** (gates: phpunit 3,951 / 3,929 passed / 22 skipped · vitest 290 / 3,383 · build · eslint 0 errors · tsc-e2e) · Zari / sana on the copy stack: POST /pos/sync with Chiffon Dupatta at the till's 900 (shop price 990), 900 cash → applied INV-000023, total 900, change 0, stock 31 → 30, note "at 900.00 (the price is now 990.00) — recorded as charged" on the sale, in the sync answer and in Reports → Offline · new tests: AnOfflineSaleKeepsThePriceItWasRungAt (8), PointsAreEarnedOnEveryPaidSale (4), CustomerCrm (+3); 18 mutations caught · found: L20 (offline slip prices a carton at a single's price — from reading, not walked) · not done: a browser offline walk of Q10 (the till side is covered by unit tests + the API sync), Q1 pending points on khata.
- **2026-10-16 · khata part 5 (installments) · push** · backend **`f6454cb`**, panel **`eac6a67`** after all five gates exit 0 (phpunit 3,937 / 3,915 passed / 22 skipped · vitest 290 files / 3,379 · build · eslint 0 errors · tsc-e2e) · Zari / sana on the copy stack: Sana's 15 Oct shift closed counted 9,990, today's opened (5,000); INS-000001…000004 "QA Qist Walk" (03007770001), each 2 × Silk Scarf 2,900 + 10% (290) = 3,190, 500 by card, 3 × (897, 897, 896); one month in cash pressed twice → one installment, month 1 paid, drawer +897, day collected +897, sales unchanged; 500 by transfer from the card's Take payment → asked "Is this an installment?" → on the plan; khata = plan left after each step; statement "On installments / Installment charge / Installment · Cash · INS-…" · `qa-kit/p6-installments.mjs` · 24 checks PASS, 0 refused, 0 console errors · found + fixed before push (L19): card payment past the plan, Due this month tile opened this week, returned goods counted as paid, To collect asked a paid-ahead customer, the form let a card advance through with no shift; L18 cash on a khata with no shift · not done: selling on installments from the till, a receipt per installment, markup on a part return.
- **2026-10-16 · khata part 4 · push** · backend **`8721241`**, panel **`5616dcb`** after all five gates exit 0 (phpunit 3,917 / 3,895 passed / 22 skipped · vitest 287 files / 3,363 · build · eslint 0 errors · tsc-e2e) · Zari / sana: LAY-000002 "QA Paid Up" held with 990 by card (paid in full); On advance: Open 2 · Overdue 0 · Not paid 30+ days 0 · Paid up 1; LAY-000002 green "Paid up — hand over" (opens it), LAY-000001 51% · 490 left · last paid yesterday; the tiles open their lists (`qa-kit/p6-advances.mjs`). Overdue and quiet cannot be made on a live day — covered by `TheAdvanceListSaysWhatToDoTest` (travelTo; 5 mutations caught) · L17 FIXED · next: part 5 (installments).
- **2026-10-15 (night) · khata part 3 · push** · backend **`43af111`**, panel **`8b9e4f1`** after all five gates exit 0 (phpunit 3,915 / 3,893 passed / 22 skipped · vitest 286 files / 3,359 · build · eslint 0 errors · tsc-e2e) · Zari / sana: INV-000018 on khata (990) for "QA Khata Walk", 600 by transfer on the card → day sales 6,970 and report revenue 6,970 unchanged; day collected 0 → 600, report collected +600; the strip names the customer, Transfer, 7:19 PM, Sana Malik; the name opens Customers (`qa-kit/p6-khata-collected.mjs`, 0 failed requests) · L14 FIXED · migration `2026_10_15_000003` run on dev · next: part 4 (On advance list).
- **2026-10-15 (night) · khata part 2 · push** · backend **`2a6d657`**, panel **`c6a2ade`** after all five gates exit 0 (phpunit 3,912 / 22 skipped · build · eslint 0 errors · tsc-e2e · vitest exit 0 but it COLLECTED 270 of 285 files — re-run on the pushed tree: 285 files, 3,356 tests, exit 0) · load-test grocery owner: dashboard tile → Owe money (288,280.04 · 34 = API = dashboard), limit filter 4, advance 0, Take payment opens the card, export 34 rows all owing (`qa-kit/p6-customers-owe.mjs`, 0 failed requests) · L16 FIXED · next: part 3 (collections).
- **2026-10-15 (night) · khata part 1 · push** · backend **`5badf6e`**, panel **`cae1da4`** after all five gates exit 0 (phpunit 3,908 / 3,886 passed / 22 skipped · vitest 3,351 · build · eslint 0 errors · tsc-e2e) · Zari / sana: a credit sale on "QA Khata Walk" (INV-000017, 990), paid 1,040 by transfer → asked, kept 50 as advance, invoice opened from the statement (`qa-kit/p6-khata-advance.mjs`, 0 failed requests) · L13, L15 FIXED · next: part 2 (Customers Owes column + filters).
- **2026-10-15 (late) · products + Add item · push** · backend **`9a15d9e`**, panel **`17c61c9`** after all five gates exit 0 (phpunit 3,907 / 3,885 passed / 22 skipped · vitest 3,342 · build · eslint 0 errors · tsc-e2e) · Add item walked (stock 24, barcode, cost, alert all saved; till scan finds it; retire → Inactive + till "No item found"; back → Active) · fixed: L10 the edit form undid a change made in its first seconds (refetch re-fill), L11 opening stock now the first line of the stock history, L12 the description refusal has two ways out · no migration · **NEXT (user to say):** Reports / Quotes & advances / Day & banking figures + UI review; L3 heavy till sync on product pages; then TESTER-BRIEF §5 (R1–R24).
- **2026-10-15 (late) · supplier payment history · push** · backend **`a39b51c`**, panel **`659b392`** after all five gates exit 0 (phpunit 3,904 / 3,882 passed / 22 skipped · vitest 3,340 · build · eslint 0 errors · tsc-e2e) · L9: every payment on the order (Ordered / Arrived / Paid / Left + each payment's date, method, reference, share) and Suppliers → History (payments with their orders, orders with what is left) · **migration `2026_10_15_000002`** (`supplier_payment_allocations`; run on dev) · walked (`qa-kit/p6-supplier-history.mjs`: Zari paid 2,000 on account → PO-000001; history adds up) · **NEXT:** Products + Add item walk, then Reports / Quotes & advances / Day & banking figures + UI.
- **2026-10-15 (evening) · the user's paper choice + customer question · push** · backend **`65acb1e` `207bd67`**, panel **`34910ce` `23ab504`** after all five gates exit 0 (last: phpunit 3,902 / 3,880 passed / 22 skipped · vitest 3,335 · build · eslint 0 errors · tsc-e2e) · built: quotations print on their own paper (`document_paper`, default A4; the till does not ask, the document page asks with it picked); L7 one number = one customer (+92, dashes, spaces); L8 "Already on file" on the till's Customer box and the quotation form · walked (`qa-kit/p6-paper.mjs`, `p6-customer-find.mjs`; 0 refusals, 0 console errors) · no migration · Q11 asked (does a typed name rename the customer?) · **NEXT:** supplier payment history on the supplier and the PO (built on the copy), then the rest of the review list.
- **2026-10-15 (afternoon) · the user's shift report + review list part · push** · backend **`74c737e` `ea900ee`**, panel **`39680e3` `43f4228`** after all five gates exit 0, twice (last: phpunit 3,897 / 3,875 passed / 22 skipped · vitest 3,328 · build · eslint 0 errors · tsc-e2e) · fixed: L4 (a counter sale needs TODAY's shift — till, tab settle, New Sale, exchange, quote billed; red strip on the till), L5 (Close shift with nothing counted), L2 (a cash advance follows the same rule), L6 (Reports bucket profit was the revenue) · walked on the copy stack (`qa-kit/p6-shift.mjs`, `p6-shift-close.mjs`, `p6-advance-shift.mjs`; 0 refusals, 0 console errors) · no migration · `docs/decisions/shopos-a-counter-sale-needs-todays-shift.md` · found and open: L7 (a customer found by the phone exactly as typed), L8 (no customer search on the Quotations form or the till) · **NEXT:** L7 + L8, then the rest of the review list (Quotes & advances UI, Day & banking, Products + Add item, supplier payment history), then TESTER-BRIEF §5 (R1–R20).
- **2026-10-15 · fixes for passes 4–5 + the owner's B01 · push** · backend **`8d60f93`**, panel **`ba50d68`** after all five gates exit 0 (phpunit 3,893 / 3,871 passed / 22 skipped · vitest 3,317 · build · eslint 0 errors · tsc-e2e) · fixed: B01 (PIN approval), B11, B12, B27, B32, B33, B52–B62, plus a stable key on four more forms; "New quotation" / "Hold goods on advance" on the Quotations screen (the user's ask) · 2 migrations (`sale_returns.approved_by/approved_at`, `products.for_sale`) · every fix walked on the copy stack (`qa-kit/p5-zari.mjs`, `p5-trades.mjs`, `p5-new-quote.mjs`; 0 refusals, 0 console errors) · `docs/decisions/shopos-a-refund-is-approved-and-an-ingredient-is-not-sold.md` · **from today the local session tests too** (the cloud tester's credits ran out) · **NEXT:** the user's review list (Reports, Quotes & advances, Day & banking — figures and UI; Products page + Add item; supplier payment history), then TESTER-BRIEF §5 (R1–R16, §5b).
- **2026-10-14 · 2-leftovers + 4 + 5 (part) · cloud tester pass 4 addendum + pass 5** · Phase 4 grocery 7 checks PASS (B59, B60); pharmacist receives a PO with batches PASS; recipe stock PASS; "ingredient, not sold" FAIL (B62); B61 · reports `TESTER-REPORT-2026-10-14-pass-4-retests.md` (§5) and `TESTER-REPORT-2026-10-14-pass-5-part.md`.
- **2026-10-14 · re-tests R1–R14 + 2-leftovers · cloud tester pass 4** · 12 PASS, R9 API PASS (screen B53, B58), R13 FAIL in part (B55, B56); waiter / cashier settle tabs PASS (no drawer — closed day, B14) · B52–B58 · `TESTER-REPORT-2026-10-14-pass-4-retests.md`.
- **2026-10-14 (late) · fixes for passes 2–3 · push** · backend **`5e2bcf6`**, panel **`3835cbb`** after all five gates exit 0 · fixed: B03, B04 (split / khata returns), B07 (money forms answer once — `AnswerOnce`), B08 (receipt), B30, B31 (exchange sheet asks /sales/worth), B38 (cost on every line), B39 (dashboard per permission), B40 (sent food needs sales.void), B41 (tank fuel never on a PO), B46, B48 (each synced sale checked alone; the till splits a refused batch), B01's exchange warning; owner's Q7 (subscription owner-only) and Q9 (supplier money stripped) built · 2 migrations (`voided_by`, `answered_requests`) · `docs/decisions/shopos-each-person-their-share.md` · **NEXT (tester pass 4):** TESTER-BRIEF §5 (R1–R14, Phase 2 leftovers, Phase 4) · **NEXT (fixer):** Q10 (B47) answer, B01 PIN, then P2s.
- **2026-10-14 · 3 · cloud tester pass 3 · built app :4173** · offline hard cases on `e14bf9e`/`db44390` · 1, 5, 8, 10 PASS; 2 (B51), 3 (B47), 4b (B48), 7 (B50), 9 (B49) FAIL; 6 BLOCKED · details in `BUGS.md`.
- **2026-10-14 · 1-leftovers + 2 · cloud tester pass 2** · re-tests R1–R12 (11 PASS, R3 part); storefront order PASS; Phase 2 probe of 359 routes × each set (4,341 calls) · B31–B46 + Q6–Q9 · details in `BUGS.md`.
- **2026-10-14 · 1 (part 1) · push** · the six fixes of 2026-10-13 night gated (phpunit 3,811 passed · vitest 3,289 · build · eslint · tsc-e2e — all exit 0) and pushed: backend **`e14bf9e`**, panel **`db44390`**; help updated; `docs/decisions/shopos-money-back-and-sizes-bought.md` · **NEXT (tester pass 2):** re-test R1–R12 in `TESTER-BRIEF.md` §5a (B02, B01 warning, B06, B05, L1, B13, B22, B29 part), Phase 1 leftovers (storefront order), then Phase 2 · **NEXT (fixer):** OPEN P1s B03, B04, B07, B08 and the owner's B01, then P2.
- **2026-10-14 · 1 · cloud tester pass 1 · fresh stack, "Zari Clothing QA" / Sana, Bilal, Usman, Farah, Hina, Saad** · the whole Phase 1 list on backend `e2c3a21` / panel `06a067e` (without the part-1 fixes) · UI through the kit, every figure read back · 30 bugs (8 P1, 9 P2, 13 P3) + 5 owner questions — all in `BUGS.md` · items 3, 5, 6, 9, 10, 11 PASS (with bugs); 1, 2, 4, 7 (Main), 8 FAIL; chorus: sales agree, profit and size stock disagree.
- **2026-10-13 night · 1 (part) · Zari / hina, bilal, usman (copy :5198/:8001)** · returns (2, one with a discount — refund shown before the press, 4,990 and 2,450), exchanges (dearer +200; cheaper −1,100), khata (1,000 cash → credit sale 990 → 2,940 card; balance + statement + drawer right), supplier + 2 POs, receive by the stock keeper with a size at 0, cancel the rest, pay supplier cash + transfer · `p1-state/returns/drawers/exchange/khata/po-raise/po-sizes/po-receive/supplier-pay.mjs` · **6 bugs FIXED (landed in the real tree, NOT gated, NOT committed):** (1) P1 cash refund by someone with no shift reached no drawer and nobody was told → `returns/worth` says `drawer`, the sheets warn before the press, the answer warns (`CashHandedBackIsCountedSomewhereTest`); (2) P1 exchange for something cheaper refused ("no cash was handed over") → the exchange credit counts as cash for change (`ExchangeForSomethingCheaperTest`); (3) P1 stock keeper got 403 on Receive (request asked purchases.manage only) (`PresetCanDoItsJobTest`); (4) P1 the PO form could not order a SIZE — orders for a sized design could never be received → form offers sizes, server refuses a size-less line, reorder list names sized designs (`OrderingSizesFromASupplierTest`, `ReorderListSeesSizesTest` rewritten); (5) P1 cancelling the rest of a part-received PO wiped what was owed for what came → `Payable::billable` keeps it, report counts what was kept, Pay sheet's "due" = arrived − paid (`CancellingTheRestStillOwesTest`, `payMath.test`); (6) P3 order date raw ISO → `date:Y-m-d` + shop format; extra customer fetch after a repayment. Mutations: 18 + 3 + 1 + 3 caught. · **NEXT in Phase 1:** run the 5 gates, commit + push this part; then re-walk supplier balance (should be 10,000 owed: 26,500 − 16,500), transfer between two places, expenses/income + cashbook, close the 3 open shifts (Sana, Bilal, Hina) + the day, coupons/promotion/bank offer, quote → advance → sale, labels/stocktake/disposal, phone/online order, the chorus. Note: INV-000011 (exchange +200 cash) and RET-000001/2/3 are in NO drawer — Hina had no shift (warned); the drawers will be short/over by that at close — expected, explain it.
- **2026-10-13 · 0 · Zari / bilal, sana, farah, usman (copy stack :5198/:8001)** · built A–D; walked by hand: cashier's dashboard (profit/expenses null in the answer, no tiles), the suit's sizes 4,990 on sheet/cart/bill with no server correction, held as "QA blue shirt" → resumed → paid → sale has no customer (INV-000010); owner + accounts see both figures, stock keeper neither · `p0-cashier.mjs`, `p0-owner.mjs`; specs `till-tenders`, `labels-sheet`, `dashboard-period` (20 passed); 4 new backend tests (26 cases), 7 panel test files; 41 mutations all caught · PASS · found + fixed: a receipt with a line left out booked it in full (P1, stock + money) · not done: journey stage 07 (only its selector changed) not re-run; C not applied anywhere (dev dry run: 2,438 lines, 0 would change — no receipts for those sizes).
- **2026-10-13 · 0 · —** · the user answered A: a size with no price of its own takes the design's sale price (4,990).
- **2026-10-13 · tools · Zari / sana** · the hand-QA kit moved into the repo (`panel/e2e/qa-kit/`) · example walk against :5177 · PASS (6 requests, 0 refused, 0 console errors).
- **2026-10-13 · 3 · Zari / bilal** · offline: new product on the device without a reload; list, name search, scan (plain + size), empty size refused, unknown tag message; two sales rung offline (OFF-TILL-C8U7-000001/2); tab closed; line back on Products · kit scripts, checked on the device and through the API · PASS: both synced once, stock down · —
- **2026-10-13 · 1, 2 · Zari / all five people** · shop made by the admin (retail, garments, Pro, 21 modules); categories, sizes, designs, stock, 4 staff from the sets; 7 sales by hand (Rs 30,060; cash 13,180; drawer 18,180; tax 4,186.73; khata 2,950) · kit scripts + HAR + every figure asked of the API · 7 bugs FIXED (backend `a710e42`, panel `d176571`): size cost, margins with tax included, tax report net sales, out-of-stock count, stock keeper walled out of purchases, cashier offered refund/cancel, Subscription 403 · 4 decisions → Phase 0 · not walked: everything in the Phase 1 list.
- **2026-10-13 · 10 · all screens** · a reload asks nothing it already has; server stamp tells the device when to ask again · HAR per screen · dashboard 8 → 1 requests, products 9 → 2, sales 10 → 3, till 14 → 8 · pushed `a710e42` / `d176571`.

Full write-up of the Zari day: `docs/decisions/shopos-a-clothing-shop-lived-by-hand.md`; earlier runs: `journey/RUNS.md`.
