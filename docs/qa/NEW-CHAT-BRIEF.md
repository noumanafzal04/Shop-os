# True Serve — brief for a new testing chat (Claude or Codex)

**You are a TESTER. You find issues and write them down. You change nothing.**
You test in a real browser (Playwright driving Chromium, clicking and typing
like a shop person). You hand back ONE list of issues, each one saying which
page, what you did, what should have happened and what did happen.

Logins are NOT in this file (the repo is public). They are in
`docs/qa/LOGINS.local.md` on this Mac — a local file git never sees.

---

## 0. Hard rules — read twice

| Rule | Meaning |
|---|---|
| **Do not touch any code** | Do not edit, create, delete, rename or format any file in `backend/`, `panel/`, `mobile/`, `partner/`, `core/`, or any existing doc. No `git` command that changes anything (no commit, push, pull, checkout, stash, reset, clean). No `composer`/`npm install`, no `php artisan migrate`/`db:seed`/`tinker`/`shopos:*`/`loadtest:*`. If you find the cause of a bug, write `file:line` and a fix idea in the report — never fix it. |
| **Only two places you may write** | (1) your walk scripts, shots and notes under `~/shopos-qa/`; (2) your report file `docs/qa/TESTER-REPORT-<date>-<retail or restaurant>.md` (not committed). |
| **Nothing on live** | Never open or call `panel.cartze.shop`, `cartze.shop`, `159.223.78.102`. Only `localhost`. |
| **The servers are the user's** | Panel `http://localhost:5177`, API `http://localhost:8000/api/v1`. Never stop or restart them. If one is down, stop and tell the user. Ignore `:5198`/`:8001` (another session's copy). |
| **Data only through the app** | Make and change data only through the browser (the API only to READ back what was stored). Never SQL. Name everything you make `QA-<date> …` (e.g. `QA-1017 Lawn Suit`, customer `QA-1017 Ahmed`, phone `0300-1017001`) so it can be found and told apart. |
| **Leave settings as you found them** | If a test needs a shop setting changed, write the old value first and put it back at the end. Only use the shops named in §5. |
| **Known bugs are known** | Read `docs/qa/BUGS.md` first. Anything there as OPEN / PART / OWNER / TO BUILD: do not report again as new. If it now behaves differently, one line under "Known bugs that changed". |
| **HR is out** | Basic HR, attendance, payroll — do not test, do not report. |
| **Limits** | Sign-in allows 5 a minute (the kit waits and retries). API 240 requests a minute per person. A session token lasts 60 minutes. Never run two browsers as the same person at once. Do not run the repo's own Playwright suite (`npx playwright test`) — it writes fixtures and changes settings; write your own walks (§6). |

---

## 1. What the system is (A–Z in one page)

**True Serve** (old names: CartZe, ShopOS) is a multi-tenant "business OS" for
Pakistani shops. One installation serves many shops (tenants); each shop sees
only the parts it was given. It covers the till (POS), products, stock,
suppliers and purchases, customers and khata (credit), quotations, advances and
installments, expenses and income, staff permissions, shifts and the shop's day,
reports and the dashboard — plus a customer storefront/marketplace and a
restaurant floor (tables, kitchen, waiters, delivery).

**No payment gateway anywhere.** Cash, card, bank transfer and wallets are
*recorded*, not processed. Each shop trades in one currency (PKR here).

**The till keeps selling when the internet is down** (offline PWA, sales queue
on the device and sync later) — only for shops an admin has granted it.

### 1.1 The parts

| Part | Where on this Mac | Branch | URL (dev) |
|---|---|---|---|
| Backend — Laravel 12, PHP 8.4, MySQL, REST `/api/v1` | `backend/` | `offline/v1/backend` | `http://localhost:8000/api/v1` |
| Panel — React 19 + Vite + TanStack Query: Super-admin console, each shop's panel, the POS, the storefront | `panel/` | `offline/v1/admin-panel` | `http://localhost:5177` |
| Docs | repo root | `main` | — |
| Mobile app (customer/rider) | `mobile/` | — | **not in scope** |

Repo: `github.com/noumanafzal04/Shop-os` (public).

### 1.2 The screens, by area

| Area | URL | What it is |
|---|---|---|
| Sign in | `/signin` | one sign-in for everybody; it sends you to `/admin` or `/tenant` |
| **Super admin** | `/admin` | platform dashboard |
| | `/admin/tenants`, `/admin/tenants/new`, `/admin/tenants/:id` | shops: make one, its trade, plan, modules, offline selling, suspend/resume |
| | `/admin/plans`, `/admin/payments`, `/admin/commission` | plans, what each shop paid, commission |
| | `/admin/staff`, `/admin/customers`, `/admin/riders`, `/admin/shop-requests`, `/admin/enquiries`, `/admin/announcements`, `/admin/banners`, `/admin/audit-logs`, `/admin/config` | platform people, requests, notices, logs, settings |
| **Shop panel** | `/tenant` | dashboard (Simple / Full menu) |
| Selling | `/tenant/pos` | **the till** (scan/search, cart, customer, discount, pay, hold, return/exchange, receipt, F-keys) |
| | `/tenant/sales`, `/tenant/sales/new` | sales list + one sale's sheet; a sale typed in the office |
| | `/tenant/documents` | **Quotations & advances**: quotes, goods held on advance, **On installments** |
| | `/tenant/customers` | customers, khata (who owes), advance, points, statement |
| | `/tenant/promotions`, `/tenant/coupons`, `/tenant/bank-offers` | offers |
| | `/tenant/orders`, `/tenant/orders/new` | phone/online orders, "Take order" |
| Stock | `/tenant/products`, `/tenant/categories`, `/tenant/collections`, `/tenant/labels` | catalogue (sizes/colours = variants, packs/cartons = units, barcodes), barcode labels |
| | `/tenant/inventory`, `/tenant/stock-by-place`, `/tenant/transfers`, `/tenant/stocktake`, `/tenant/disposals` | stock, per place, moves, counts, write-offs |
| | `/tenant/suppliers`, `/tenant/purchases` | suppliers, purchase orders, receiving, paying suppliers |
| Money | `/tenant/expenses`, `/tenant/income` | money out / other money in |
| | `/tenant/cashbook`, `/tenant/ledger` | each day's totals / what each day was made of |
| | `/tenant/day` | **Day & banking**: shifts, drawers, khata collected, close the day |
| | `/tenant/reports` | sales, profit, tax, offline, per period |
| Restaurant | `/tenant/dine-in`, `/tenant/dine-in/tickets/:id` | floor: tables, tabs, send to kitchen, bill, split, settle |
| | `/tenant/kitchen` | kitchen board (tickets, mark ready) |
| | `/tenant/reservations`, `/tenant/riders` | bookings; delivery riders |
| Shop | `/tenant/staff`, `/tenant/branches`, `/tenant/settings`, `/tenant/subscription`, `/tenant/activity`, `/tenant/help` | people + permissions, places, settings, plan, audit, **Help Centre** |
| Other trades | `/tenant/pharmacy`, `/tenant/fuel`, `/tenant/workshop`, `/tenant/vehicles`, `/tenant/warranty` | only for those trades — not in this round |
| Storefront | `/`, `/shops`, `/shop/:slug`, `/p/:id`, `/cart`, `/checkout`, `/my-orders` | customers buy online from a shop |

**The Help Centre (`/tenant/help`) describes every screen as it should work.**
When unsure what is "right", read the help topic first; a screen that does not
do what its help says is an issue.

### 1.3 Three things decide what anyone sees — learn these first

| Axis | What | Who sets it |
|---|---|---|
| **MODULE** | which parts a shop has: `products, services, pos, documents (Quotes & Advances), inventory, purchasing, stocktake, disposals, labels, customers, promotions, bank_offers, expenses, images, marketplace, delivery, reservations, kitchen, dine_in, fuel` (`hrm` = out of scope) | super admin (via the plan / the shop's page) |
| **TRADE** | `business_type`: food (restaurant/café), mart (grocery), pharmacy, retail (garments, shoes, books…), wholesale, services, automotive, petroleum, online, finance | chosen when the shop is made; it *proposes* modules, it does not grant them |
| **PERSON** | **permissions** — there are NO roles. "Cashier", "Waiter", "Kitchen", "Stock keeper", "Purchasing", "Online orders", "Accounts", "Shift supervisor", "Manager", "Pharmacist", "Forecourt attendant" are permission **sets** picked on the staff form | the shop owner |

A screen is offered only when the shop has the module AND the person has the
permission. A hidden screen typed into the address bar must not open, and the
API must refuse the same thing (403) — the screen hiding it is not enough.
Money figures (cost, profit, supplier balances) must not even be SENT to a
person without the permission.

### 1.4 The rules of money and stock

- **The server prices everything.** The browser sends only item + quantity; the
  server works out price, discount, tax and total. The till's bill must equal
  the server's bill to the paisa.
- **Shop day** turns at 05:00 (a shop setting), not midnight. A sale at 02:00
  belongs to yesterday's day.
- **Shift** = one person's drawer for TODAY. If the shop's setting "Require open
  shift" is on, a counter sale or cash taken needs today's own shift (an
  earlier day's open shift is refused). Close shift = count the drawer;
  difference = over/short. **Close the day** in Day & banking.
- **Places**: a shop can have branches and a warehouse; stock is kept per place;
  only `inventory.any_place` lets a person see/move another place's stock.
- **Khata** = customer owes the shop (credit sale). **Advance** = the shop holds
  the customer's money. Paying more than owed asks first (keep as advance or not).
- **Quotations & advances**: quote → goods held on advance (part paid) → billed
  as a sale. **Installments**: goods go home now, paid monthly with an optional
  charge; the plan's months, "To collect", Late, Paid off.
- **Loyalty points**: earned on every paid sale (till, completed online order,
  settled tab, billed quote); redeemed at the till only.
- **Offline**: an offline sale keeps the price the till charged; if the shop
  changed the price meanwhile, the sale is kept and flagged in Reports → Offline.
- **One press = one record.** Double-clicking Pay / Save / Take payment must make
  one record, never two.
- **The chorus**: one figure must agree everywhere it appears — the sale, stock
  (per size, per place), drawer, cashbook, ledger, Day & banking, Reports,
  Dashboard, the customer's khata, the supplier's balance. Disagreement = bug.

### 1.5 Subscription states

`active` (normal) · `grace` (works, warned) · `lapsed` (can READ, every WRITE
answers 403) · `suspended` (blocked). A shop admin can extend or suspend.

---

## 2. Read these before testing (about 30 minutes)

| Order | File | Why |
|---|---|---|
| 1 | this file | the map and the plan |
| 2 | `docs/qa/LOGINS.local.md` | who to sign in as |
| 3 | `docs/qa/BUGS.md` | every known bug + the owner's answers — do not re-report |
| 4 | `docs/qa/SYSTEM-TEST.md` §2 and §5 | how a check is proven; phases and what is already PASS |
| 5 | `MODULE-GUIDE.md` | how the till, products, cashbook, ledger, expenses work |
| 6 | `BUSINESS-FLOWS.md`, `BUSINESS-TYPE-WORKFLOWS.md` | per trade: who gets which screen, how the trade works |
| 7 | `docs/qa/TESTER-BRIEF.md` §5 (R1–R32) and §6 | recent fixes and how to re-test them; permission sets table |
| 8 | the Help Centre topics for each area, while you test | expected behaviour |

`START-HERE.md` and `HANDOVER.md` are for developers; on this Mac the folders
are `backend/` and `panel/` (not `shopos-backend/` etc.).

---

## 3. How you test — a real browser, every time

1. **Every action is done in the browser** the way a person would: open the
   page, click the button by its visible name, type in the labelled box, press
   Enter. Never "test" a screen by calling the API instead.
2. **Then prove it five ways:**

| Proof | How |
|---|---|
| The screen says it | what the person sees after the action **and after a reload** |
| The server took it | the request's status code is the expected one |
| It is stored as typed | read it back with `qa.ask("/path")` — every field, every figure to the paisa |
| Everything that follows agrees | the chorus (§1.4): stock, khata, drawer, cashbook, day, reports, dashboard |
| Nothing else happened | 0 console errors, no unexpected 4xx/5xx, no request sent twice in one step, nothing slower than 1.2 s |

3. **Work the figures out by hand first** (write the expected numbers in your
   notes), then compare with every screen.
4. **Screenshot every step** (`qa.shot("name")`) — the bug report points to them.

### 3.1 The tool — `panel/e2e/qa-kit/kit.mjs` (Playwright)

Use it as it is (do not edit it). Your scripts live in `~/shopos-qa/` and
import it by its full path:

```js
// ~/shopos-qa/r01-catalogue.mjs
import { open, textOf } from "/Users/noumanafzal/PhpstormProjects/chordhr-app/chordhr-web-mobile-app/panel/e2e/qa-kit/kit.mjs";

const qa = await open("<owner email>", { password: "<password>", stage: "r01-catalogue" });
try {
  qa.step("add a product");                 // marks where one thing ends and the next begins
  await qa.page.goto("/tenant/products");
  await qa.quiet();                         // waits for the page to settle
  await qa.page.getByRole("button", { name: /add/i }).click();
  // … fill the form by its labels, save …
  await qa.shot("product-saved");
  const back = await qa.ask("/products?search=QA-1017");   // read back as this person
  console.log(back.status, JSON.stringify(back.data).slice(0, 400));
  console.log(qa.report());                 // refusals, console errors, repeats, slow + heavy requests, per step
} finally {
  await qa.close();
}
```

Run: `cd ~/shopos-qa && QA_OUT=~/shopos-qa/out node r01-catalogue.mjs`

- `open(email, { password, stage, viewport, mobile })` → `{ page, step, shot, ask, report, quiet, close, rows, errors }`.
  Phone: `{ viewport: { width: 390, height: 844 }, mobile: true }`. Tablet: `{ width: 1024, height: 768 }`.
- Every API call the page makes is recorded (status, ms, size, what was sent, the body of a refusal). HAR files go to `QA_OUT/har/`, shots to `QA_OUT/shots/`.
- The kit's browser is headless Chromium (a real browser). If you want a
  visible window, write your own script that imports
  `/Users/noumanafzal/PhpstormProjects/chordhr-app/chordhr-web-mobile-app/panel/node_modules/@playwright/test/index.mjs`
  and launches `chromium.launch({ headless: false })`.
- Printing: check the receipt / quotation preview on screen. If a real print
  dialog blocks the browser, note it and move on.

### 3.2 Request times — measure, do not guess

For every step, from `qa.report()` and the HAR:

| What | Record | Issue when |
|---|---|---|
| Page open time | goto → page quiet, in ms | over 2 s on desktop (P3); the till over 2 s (P2) |
| Each API call | method, path, status, ms, size | any call over 1.2 s (P3); over 3 s, or on the till's Pay/scan (P2) |
| Calls per step | how many, and repeats | the same request twice in one step, or a list asked again on a reload with nothing changed |
| Heavy answers | size in KB | an answer over ~500 KB for a normal screen |

Put a timing table at the end of each part of the report (slowest 10 calls,
with page and step).

### 3.3 Status and error codes — what is right and what is a bug

Every API answer is `{ success, message, data, errors, meta: { error_code } }`.

| Code | Means | Right when | A bug when |
|---|---|---|---|
| 200 / 201 | done | the action should succeed | the action should have been refused (permission, module, shift, limit) |
| 401 `UNAUTHENTICATED` | not signed in / token expired | after 60 min or sign-out — the app must return to sign-in without losing work | in the middle of normal work |
| 403 `FORBIDDEN`, `MODULE_DISABLED`, `SUBSCRIPTION_EXPIRED`, `TENANT_SUSPENDED` | not allowed | the person lacks the permission, the shop lacks the module, the shop is lapsed/suspended | a person who SHOULD be allowed gets it; or a screen fires a request it knows will be refused |
| 404 | not found | a wrong id, or **another shop's id** (correct answer for cross-shop) | a normal screen's own data |
| 409 e.g. `SHIFT_REQUIRED`, `SHIFT_FROM_AN_EARLIER_DAY`, `BUSINESS_DAY_CLOSED`, `TABLE_OCCUPIED`, `REGISTER_IN_USE`, `SHIFT_OPEN_ELSEWHERE` | conflict with the state | the state really forbids it, and the screen says why in plain words | the state allows it |
| 422 `VALIDATION_ERROR` and rule refusals e.g. `DISCOUNT_LIMIT_EXCEEDED`, `NOT_FOR_SALE`, `SALE_NOT_RETURNABLE`, `INSUFFICIENT_POINTS`, `ITEM_SOLD_OUT`, `VARIANT_REQUIRED`, `BARCODE_TAKEN`, `FRACTIONAL_QTY_NOT_ALLOWED`, `PO_NOT_PAYABLE` | the input breaks a rule | bad input; the field shows the message next to it | good input refused; or the screen shows nothing / a raw code |
| 429 `RATE_LIMITED` | too many requests | after hammering on purpose | in normal clicking (a screen is asking too much) |
| **500 / 502 / 503** | server broke | **never** | **always a bug (P1 at least)** — copy the response body |

Also a bug: a console error; a red error with no human words; a spinner that
never stops; a refusal that a button could have prevented (button should be
shut and say why).

### 3.4 Deep test — for EVERY form and action, also try

- Empty, zero, negative, a huge number, 3 decimal places, a 200-letter name,
  Urdu text, `'` `"` `<b>` and emoji in names.
- Duplicate: same barcode, same phone typed differently (`0300-1234567`,
  `03001234567`, `+92 300 1234567`) — must be the same person.
- Double-click every money button (Pay, Save, Take payment, Receive, Refund).
- Reload in the middle of a form, Back button after saving.
- The same flow on phone width (390×844) and tablet (1024×768).
- Lists: search, every filter, sort, page 2, export CSV — counts on filter
  buttons equal the rows shown.
- Permissions: the same action as a person without the permission (menu,
  typed URL, and the API answer).

---

## 4. Bug report format (exactly this, one block per issue)

```markdown
### BUG-<n> — <one line: what is wrong>
| Field | Value |
|---|---|
| Priority | P0 / P1 / P2 / P3 |
| Area | e.g. Till · Khata · Purchases · Dine-in |
| Page | screen name + URL, e.g. "Till" `/tenant/pos` |
| Who | the login used (email) and their permission set |
| Shop | shop name + trade |
| Device | desktop 1440×900 / tablet / phone |
| Steps | 1. … 2. … 3. … (exact clicks, exact values typed) |
| Expected | what should happen, with the figure you worked out |
| Actual | what happened — exact message / figure on screen |
| API | `METHOD /path` → status, `error_code`, time ms, the key part of the body |
| Console | console errors, if any |
| Evidence | shot file(s) in `~/shopos-qa/out/shots/`, HAR file |
| Repeats | always / sometimes (n of m) |
| Known? | new / same as BUGS.md Bxx (only if it CHANGED) |
| Cause (optional) | `file:line` and a fix idea — do NOT change the file |
```

Priorities: **P0** data lost, one shop sees another, money or stock counted twice ·
**P1** a core flow broken, wrong money/stock/tax, a permission bypass, any 500 ·
**P2** a module/sync defect, a slow till, a confusing refusal · **P3** looks, words, speed.

**The report file** `docs/qa/TESTER-REPORT-<date>-<retail|restaurant>.md`:
1. Header: date, the three commits tested (`git -C backend log -1 --oneline`, same for `panel` and the root), who you signed in as.
2. **Summary table**: area · checks run · PASS · FAIL · BLOCKED.
3. **Issues list** — the short table first (BUG-n · priority · page · one line), then each BUG block.
4. Known bugs that changed (one line each).
5. Timing table (slowest 10 calls), and every non-2xx call that was NOT expected.
6. What was NOT tested and why.
7. Everything you created (names), so it can be found.

---

## 5. Which shops

| Part | Shop | Trade | State |
|---|---|---|---|
| A — Retail | **Zari Clothing** (owner + cashier, stock keeper, accounts, manager) | retail · garments, plan Pro, all modules | active; real hand-made data — the main retail shop |
| A (optional) | Sweep Mart | mart (grocery) | active till 2026-11-10 |
| A (read only) | Trendz Retail (seeded demo) | retail | **grace** — good for checking the grace warning |
| B — Restaurant | **Sweep Food Restaurant** (owner + one staff login per permission set) | food | active till 2026-11-10 |
| B (read only) | Karahi House (seeded demo) | food | active, has demo history |
| Admin | the dev super admin | — | — |

Exact emails and passwords: `docs/qa/LOGINS.local.md`.

---

## 6. PART A — RETAIL (Zari Clothing). Do in this order.

Make a folder per part: `~/shopos-qa/retail/`. One script per step below
(`a01-….mjs`). Before starting, write in your notes today's figures for the
shop (Dashboard today, Day & banking, Reports today) so you can compare deltas.

| # | Step | As | Do (in the browser) | Prove |
|---|---|---|---|---|
| A0 | Learn the shop | owner | Dashboard (Simple and Full), every menu item once, Settings (all tabs, read only), Help Centre topics for Till, Products, Customers, Quotations, Day & banking | every screen opens; 0 console errors; no 4xx/5xx; page times recorded |
| A1 | Super admin view | super admin | `/admin/tenants` → Zari: trade, plan, modules, offline selling, staff count; `/admin/plans`, `/admin/payments` (read only) | figures match what the shop's Subscription page says |
| A2 | Catalogue | owner | Add `QA-<date> Lawn Suit`: category, price 2,500, cost 1,600, sizes S/M/L (own barcode each), opening stock 5 each; one size with its own price 2,700. Add a plain item with a pack/carton unit. Edit one field and save (nothing else may change). Make barcode labels for the sizes. | list, item page, till search and stock all agree; stock movement says "Opening stock"; edit changed only that field; labels show the right price/barcode |
| A3 | Shift | cashier | Open the till; if asked, open today's shift with a counted float (e.g. 2,000) | the drawer shows the float; Day & banking lists the shift |
| A4 | Till sales | cashier | (a) cash sale of 2 sizes, change given; (b) card; (c) split cash + card; (d) a discount inside the ceiling, then one above it (must be refused/need a supervisor); (e) sale to a customer typed by phone; (f) hold a ticket, open it again, pay; (g) double-click Pay | each bill = server's total to the paisa; stock per size down; receipt preview right; (d) refused with a clear reason; (g) one sale |
| A5 | Return and exchange | cashier, then manager | Return one size for cash (needs approval + PIN as cashier); exchange M for L (dearer) and L for S (cheaper) | refund shown BEFORE the press; stock back on the right size; drawer down by the refund; differences paid/given back; sale history shows both |
| A6 | Khata | cashier → owner | Sell 990 on credit to `QA-<date> Ahmed`; on the customer: Take payment 500 (cash), then 1,040 by transfer (more than owed → "Keep as advance"); open the statement | balance 990 → 490 → −50 (advance, green); statement lines; Day & banking "Collected on khata"; Reports show it outside Revenue |
| A7 | Quotations & advances | owner | Quote for 2 items → print preview → turn into "On advance" with part paid → pay the rest → bill it as a sale | each step's figures; stock leaves only when billed; one sale |
| A8 | Installments | owner | On installments → Sell on installments: 2 items, a customer with phone, 10% charge, 3 months, advance by card; take month 1 in cash (double-click); every filter and tile; customer's card → Take payment → "Is this an installment?" | form "X now + 2 × M + L = Bill" = plan figures; one record per press; khata up by financed amount; charge under Other income |
| A9 | Purchases | manager → stock keeper → owner | Add supplier `QA-<date> Textiles`; raise a PO (2 sizes, one arrives as 0); stock keeper receives at a chosen place; owner pays part (cash) and the rest by bank with a reference | stock + cost per size land; the missing size did not; supplier owed → paid; PO shows Ordered/Arrived/Paid/Left; stock keeper sees no money |
| A10 | Stock tools | stock keeper / manager | Transfer between two places and sell from the second; stocktake with one difference; a disposal (damaged) | stock per place right at every step; stocktake/disposal in stock movements |
| A11 | Offers | owner → cashier | A promotion (e.g. 10% over 5,000), a coupon, a bank card offer; ring sales that hit each | the customer pays the lower price; receipt and Reports show each discount |
| A12 | Expenses and income | accounts | An expense in cash (with category and receipt image), another by bank; an income | cashbook, ledger, Reports and Dashboard all show them |
| A13 | Online / phone order | owner | Take order (phone) → accept → dispatch → complete; one cancelled | stock and money only on completion; points earned on the completed one only |
| A14 | Close | cashier → owner | Close the shift: first type nothing (must be blocked), then count with a 100 difference; owner closes the day | variance shown; day closed; then try a sale (see BUGS B14 — known) |
| A15 | The chorus | owner | Ask every screen: "how much was sold today, cash in drawers, profit, and how many `QA-<date> Lawn Suit` size M are left?" — Sales list, Day & banking, Cashbook, Ledger, Reports, Dashboard, Stock by place, item page | every screen gives the same figures as your hand sums |
| A16 | Who may do what | cashier, stock keeper, accounts, manager | For each: the menu; type 5 hidden URLs (`/tenant/settings`, `/tenant/staff`, `/tenant/reports`, `/tenant/purchases`, `/tenant/expenses`); try one forbidden action; read `/dashboard` and `/products` via `qa.ask` | hidden screens do not open; API 403; no cost/profit in the answers of people without the permission |
| A17 | Phone + tablet | cashier | Repeat A4(a) and A6 at 390×844 and 1024×768 | nothing cut off, every button reachable, same figures |
| A18 | Cross-shop wall | owner of Zari | Take a product id / sale id from Sweep Mart (read as its owner) and ask for it as Zari | 404/403; nothing changed in Sweep Mart |
| A19 (optional) | Grocery | Sweep Mart owner/cashier | packs and cartons with own barcode/price, loose/weighed item, bulk price tier, expiry batch (FEFO) | receipt names kg and bulk rate; cheapest correct price |
| A20 (ask the user first) | Offline | cashier | needs the BUILT app (`npm run build && npx vite preview --port 4173` in `panel/`) and DevTools-style offline (`context.setOffline(true)`): sell 2 items offline, change a price on another login, come back online | each sale arrives ONCE; stock right; the changed-price sale kept and listed in Reports → Offline |

**End of Part A:** write the retail report file, give the user the issue
list, and **stop. Do not start Part B until the user says.**

---

## 7. PART B — RESTAURANT (Sweep Food Restaurant). After the user says go.

Folder `~/shopos-qa/restaurant/`. The waiter works on a **phone** (390×844),
the kitchen on a **tablet** (1024×768), the cashier/owner on desktop.

| # | Step | As | Do | Prove |
|---|---|---|---|---|
| B0 | Learn the shop | owner | Dashboard, Dine-in, Kitchen, Take order, Orders, Riders, Products (menu), Settings → restaurant parts; Help topics for Dine-in and Kitchen | screens open; 0 errors; times recorded |
| B1 | Menu | owner | Add `QA-<date> Chicken Karahi` with sizes (Half / Full), questions/modifiers (spice level, extra naan +50), and a recipe using 2 ingredients (one "not sold to customers") | the dish sells; the ingredient is offered nowhere; recipe cost shown |
| B2 | Tables | owner | Check the floor: tables and areas; add `QA-T1` | table shows on the floor for waiters |
| B3 | Waiter order | waiter (phone) | Open QA-T1 → add 2 dishes with size + modifiers → note → Send to kitchen; add one more item later; double-click Send | one kitchen ticket per send; the bill shows sizes/modifiers and prices |
| B4 | Kitchen | kitchen (tablet) | The ticket appears with sizes, questions, notes, "for here / takeaway"; mark ready / bump | the waiter sees it ready; the kitchen sees nothing else (no till, no money) |
| B5 | Bill and settle | waiter → cashier | Print/preview the bill; split it 2 ways (by item, then by amount); settle one part cash, one card | totals = server's; table frees; sale(s) in Sales, drawer, reports; recipe stock down |
| B6 | Hard cases | waiter / supervisor | Void an item after the kitchen has it (needs supervisor); a dish refused/sold out; move a tab to another table; another waiter (`other-waiter`) tries to open/settle QA-T1 | void needs approval and reaches the kitchen; sold-out refused clearly; move keeps everything; other waiter refused (if that is the shop's rule — read Help) |
| B7 | Takeaway + delivery | cashier / online orders | Take order (phone) → takeaway; a delivery order with a delivery fee → assign a rider → complete; one cancelled | stock and money on completion; delivery fee recorded (see BUGS B34 — known); points on completed only |
| B8 | Restaurant chorus | owner | Sold today, per payment method, dishes sold, ingredient stock left — Dine-in history, Sales, Day & banking, Reports, Dashboard | all agree with your sums |
| B9 | Who may do what | waiter, kitchen, cashier, shift supervisor, stock keeper, accounts, buyer, online orders, manager | menu + typed URLs + one forbidden action each (see `TESTER-BRIEF.md` §6 table) | screen hidden AND API 403; no money to those without it |
| B10 | Close | cashier → owner | Close shifts (count), close the day | variances right; day report = the day's sum |
| B11 | Phone/tablet | all | B3–B5 on `restaurant-phone` (390×844) and tablet portrait (768×1024) | nothing cut off; buttons reachable |

**End of Part B:** write the restaurant report file, give the user the issue
list, and stop.

---

## 8. Known, open — do not report as new (full list in `docs/qa/BUGS.md`)

B34 online order's delivery fee not recorded · B14 a closed day still takes
sales · B21 exchange inflates the dashboard · B43 expenses module off → profit
wrong · B09/B10 exchange (shift rule, customer and points) · B49/B50/B51 offline
(refused sale not cleared, last piece sold on two tills) · L20 offline slip
prices a carton at a single's price · B15–B18, B23–B26, B28, B35–B37, B42,
B44, B45 · open owner questions Q1–Q5 (not bugs). HR is out.
