# Money test — every paisa, every screen (tester brief)

**Paste to a new chat:** "Read `docs/qa/MONEY-TEST-BRIEF.md` and do what it says. You only test —
change no code, commit nothing. Write the report as you go to the path in section 9."

You are the tester. Another session (the fixer) fixes what you find. A business that runs on this app
loses real money if one figure is wrong, so your one job is to prove that **every rupee and paisa that
goes in, goes out or moves is stored right, shown right, and counted once — in every screen and report
that names it.**

## 1. Rules

| Rule | Why |
|---|---|
| **Test only.** No change to any file in `backend/`, `panel/src`, configs, migrations, tests. Your only writes: the report (section 9) and walk scripts named `panel/e2e/qa-kit/.money-*.mjs` (the leading dot keeps them out of commits). | The fixer fixes. If you find the cause, write `file:line` and a fix direction. |
| No `git commit`, `push`, `checkout`, `stash`, `reset`. | Three repos share this tree with the fixer. |
| Nothing on live: `panel.cartze.shop`, `cartze.shop`, `159.223.78.102`. | Real shops. |
| Data only through the app — screens or the API. Never SQL, never `migrate:fresh`, `db:seed`, `loadtest:shops`, `demo:shops`. The one artisan command you may run: `php artisan loadtest:audit` (it only reads). | The user tests on the same `shopos` DB. |
| Do not stop or restart the servers: backend `:8000`, panel `:5177`. | The user is using them. |
| No password, token or key in the report. Logins: `docs/qa/LOGINS.local.md` — read it, never copy from it. | The repo is public. |
| HR (Basic HR, attendance, payroll) is out — do not test it. | Not in this version. |
| Rate limits: sign-in 5 a minute, API 240 a minute per person, a token lives 60 minutes. | A 429 is your pace, not a bug. |

## 2. Your stack

- Panel `http://localhost:5177`, API `http://localhost:8000/api/v1`, DB `shopos` (dev).
- Write at the top of the report the commits you tested:
  `git -C backend rev-parse --short HEAD`, `git -C panel rev-parse --short HEAD`, `git rev-parse --short HEAD`.
- Tools:
  - The hand-QA kit `panel/e2e/qa-kit/kit.mjs`: `open(email, {password})` → `{page, step, shot, ask, report, close}`. `ask` calls the API as that person. `report()` lists console errors, 4xx/5xx and repeated requests. Copy `example-walk.mjs` to `.money-<part>.mjs`, then run `cd panel && node e2e/qa-kit/.money-<part>.mjs`.
  - Playwright, for the browser and for screenshots (`panel/test-results/qa/`, not committed).
  - Plain API calls with a token: `POST /auth/login` takes `identifier` and `password`.
- **Make your own shops**, so every total starts from zero and you know every paisa in it. Use the platform admin in `LOGINS.local.md`, on a plan that gives every module. Name each shop `Paisa QA <trade>`, e.g. `Paisa QA Mart`. Add staff as permission sets (Cashier, Shift supervisor, Accounts, Stock keeper, Manager). Existing shops (Zari, Sweep…) are only for comparison.

## 3. The method — work out the answer FIRST

1. Before every action, write in the report's ledger (section 9) what each figure **must** become, worked out by hand from the inputs, with the arithmetic shown. Never take a figure from the screen as the expected one.
2. Do the action the way a shopkeeper would, in the UI. Use Playwright for clicks; the API only to read back.
3. Read the figure in **every place that names it** — the "chorus" (section 6).
4. Reload and read again. Export the CSV where there is one, and compare it to the screen.
5. Mark the line PASS only when every place agrees with your figure **to the paisa**. One place off is a FAIL, even if the rest agree.

Use awkward numbers on purpose: 333.33 × 3, 0.375 kg × 1,240/kg, 7.5% off 1,999, tax 17% on 99.99, three tenders on one bill, and quantities that do not divide evenly. Round numbers hide bugs.

## 4. Where money lives — test every row

| # | Area | What to do | What must hold |
|---|---|---|---|
| M1 | Till sale | A plain item; a size; a pack/carton; an item sold by weight; a wholesale tier; a sale price; a line discount; a bill discount (% and amount, at and past the cashier's ceiling); a coupon; a promotion; a bank offer | Line total = qty × the right price; discount applied once; the bill = Σ lines − discounts + tax; receipt = screen = API |
| M2 | Tax | Shop tax exclusive, then inclusive; an item in another tax group; tax on a discounted line | Tax on the amount actually charged; Σ line tax = the bill's tax = Tax report |
| M3 | Paying | Exact cash; cash with change; card; transfer; split cash + card + transfer; cash rounding 1, 5, 10; tip (if on) | Σ tenders = bill; change = given − due; rounding never more than the step, and the difference is shown somewhere |
| M4 | Khata (credit) sale | Sell on khata; partly paid; up to and past the credit limit; take a payment; overpay → keep as advance; use the advance | Balance = Σ credit − Σ paid; statement running balance = customer card = Owed to you; a payment is **not** revenue |
| M5 | Return / refund / exchange / void | Return part of a discounted, taxed line; refund cash from a drawer; exchange for dearer and for cheaper; void | Refund = the share actually paid (discount and tax pro-rated); stock back; drawer down by the cash out; reports drop revenue, tax and cost of goods once |
| M6 | Shift and drawer | Open with a float; cash sales, cash refunds, pay-in, pay-out, a cash expense, khata cash, advance cash, installment cash; close with a count | Expected cash = float + cash in − cash out (write each part); variance = counted − expected; card/transfer never in the drawer |
| M7 | Business day | Two shifts, then close the day; a second branch's day | Day total by method = Σ its shifts; each branch's day has only its own; collected on khata listed but not in sales |
| M8 | Quotations, advances, installments | Quote → hold on advance with a deposit → instalments → bill and hand over; cancel one; installments with a % charge, an advance and 3 months | Each paisa paid in appears once in the drawer/day; the sale is counted once, at hand-over; the installment charge goes to Other income; the khata takes what is financed |
| M9 | Purchases and suppliers | PO → receive part, a short line, a box of 12 at a box price; pay part naming the order; pay on account; cancel an order | Cost per piece = box price ÷ pieces; the average cost is weighted; supplier balance = received − paid; order "Paid" = Σ its shares |
| M10 | Stock value and cost of goods | Sell after two purchases at different costs; adjust; stocktake; dispose of a damaged item; transfer to another place | Cost of goods = qty × the average cost at the moment of sale; Valuation = Σ qty × average cost; a transfer moves value, never changes it; a loss shows as a loss |
| M11 | Expenses and income | Expense from the drawer; from the bank; a recurring one; other income; a budget | Each appears once in the Cashbook, the Ledger and Reports; a drawer expense lowers expected cash |
| M12 | Reports and Dashboard | Summary, series by day, Tax, Cashbook, Ledger, Margins, Valuation, Staff, Purchases, Bank claims, Offline; Dashboard today; a custom range of 2+ days | Net profit = revenue − refunds − tax − cost of goods + other income − expenses; the days add up to the total; Dashboard today = Reports today; CSV = screen |
| M13 | Loyalty | Earn on a sale; redeem points; a return of a sale that earned points | Points = rule × amount actually paid; redeemed value comes off the bill once |
| M14 | Double press | Double-click every final money button: Pay, Take payment, Pay supplier, Save expense, Hold, Close shift, Close day, Receive, Refund | One record each; one movement of money; no error after a success |
| M15 | Who sees money | Cashier and stock keeper: read `/dashboard`, `/products`, `/sales/{id}`, `/reports/*` through the API | No cost, profit or margin in the answer (not just hidden on screen) |
| M16 | Restaurant (second shop) | Tab → order → split bill by items and by amount → pay; service/tip; takeaway; delivery with a fee, cash on delivery through a rider | Σ split parts = the bill; the fee and the rider's cash land somewhere and once |
| M17 | Offline | Ring a sale offline, change the price on the server, reconnect | Kept at the price charged, once; Reports → Offline says so |
| M18 | Two branches | The same day's work at Main and at a second branch | Branch A + branch B = whole shop, in every report and on the Dashboard |

## 5. The laws — check every one at the end of each part

1. Σ tenders on a bill = bill total; change = cash given − cash due.
2. Sales list total = Day "Rung up" = Reports revenue for the same days, before refunds.
3. Expected drawer = float + cash sales + cash collected (khata, advance, installment) + pay-ins − cash refunds − pay-outs − cash expenses.
4. Customer balance = Σ credit sales − Σ payments; statement's last line = customer card = their row in Owed to you; Owed to you = Σ those rows.
5. Supplier balance = Σ received value − Σ payments; an order's Paid = Σ its allocations.
6. Valuation = Σ (qty on hand × average cost); a sale's cost of goods = qty × average cost when sold.
7. Net profit (law in M12); Σ daily series = totals; Dashboard today = Reports today.
8. Branch figures add up to the whole shop.
9. Money that is not a sale (khata payment, advance, deposit, supplier payment) never changes Revenue or Profit.
10. Every figure is the same after a reload and in its CSV.

Also run `cd backend && php artisan loadtest:audit` once and copy its last lines (it re-works every figure of the load-test shops a second way). A failed check there is a bug too.

## 6. The chorus — where one figure must appear

Sale screen and receipt · Sales list and the sale's detail · Shift (drawer) panel · Day & banking ·
Customer card, statement, Owed to you · Supplier page, the order, Suppliers → History · Inventory,
the item's history, Valuation · Expenses, Income, Cashbook, Ledger · Reports (each tab) · Dashboard ·
the API read of the same record.

## 7. Do not report again

Everything in `docs/qa/BUGS.md` with status **OPEN**, **PART**, **OWNER** or **TO BUILD** is known — for
money that includes B14, B17, B18, B21, B24, B25, B26, B28, B34, B43, B49–B51, L20 and B65. Known
decisions, not bugs: phone orders carry no tax; no promotions on orders. If a known one now behaves
differently (other figures), write one line under "Known bugs that changed".

## 8. Priorities

- **P0**: money or stock counted twice or lost; one shop sees another's money.
- **P1**: a wrong figure anywhere (total, tax, change, refund, balance, cost, profit); a permission that leaks money.
- **P2**: figures right, but a screen and a report disagree on wording or grouping.
- **P3**: looks, words, speed.

## 9. The report

**Path: `docs/qa/TESTER-REPORT-<yyyy-mm-dd>-money.md`** — for example `docs/qa/TESTER-REPORT-2026-10-17-money.md`.
Write it as you go, after each row of section 4, so nothing is lost if the chat runs out. Do not commit it.
If the work spans two days, keep the first file and continue in it.

In this order:

1. **Header**: the three commits, shops and people you made (no passwords), what you used (UI / API / Playwright).
2. **Summary** (one screen):
   - `M | area | PASS / FAIL / BLOCKED / NOT TESTED | one line`, one row for each of M1–M18;
   - the 10 laws: PASS / FAIL;
   - new bugs: `ID | P | area | one line`, IDs `$1, $2…` (the fixer gives them B numbers);
   - known bugs that changed, or "none".
3. **The ledger**: for each action, `what was done | figure | expected (with the arithmetic) | each place read → its value | PASS/FAIL`.
4. **Each bug**: who and which screen · steps · expected (worked out) · actual in each place · proof (invoice/PO numbers, status code, the request and answer) · cause `file:line` if found · fix direction (not done).
5. **Not tested, and why.**

When done, tell the user the report's path.
