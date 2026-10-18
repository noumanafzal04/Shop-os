# Full system re-test — every flow, every rupee (tester brief)

**Paste to the tester chat:** "Read `docs/qa/FULL-RETEST-BRIEF.md` and do what it says. You only test —
change no code, commit nothing. Write the report as you go to the path in section 8."

You are the tester. The fixer has closed every bug from your last passes (money pass $1–$12 = B73–B84,
P1–P3 lists, Q18, Q19). Now run the **whole shop, start to finish, the way a real owner and staff would**,
and prove that after **every action — every sale, every edit, every delete — every report shows the right
rupee and paisa**. One wrong figure anywhere is a bug, however small.

## 1. Rules, stack and method — same as before

Sections 1, 2, 3, 5, 6 and 8 of `docs/qa/MONEY-TEST-BRIEF.md` still apply word for word: test only,
nothing on live, data only through the app, no passwords in the report, HR out; work out every expected
figure BY HAND before the action; read it in every place (the chorus); PASS only when all agree to the
paisa; the 10 laws; P0–P3.

Write the commits you tested at the top of the report (`git -C backend rev-parse --short HEAD`,
`git -C panel rev-parse --short HEAD`, `git rev-parse --short HEAD`).

**Make new shops** so every total starts at zero: `Hisaab QA Mart` (grocery: packs, loose by weight,
tiers), `Hisaab QA Clothing` (sizes, exchanges), `Hisaab QA Cafe` (dine-in, kitchen, takeaway). Each on a
plan with every module, two places (Main + one more), and staff as permission sets: Cashier, Shift
supervisor (with a till PIN), Stock keeper, Accounts. Write who is who in the report (no passwords).

## 2. The flows — run each in order, in each shop where it fits

Keep a **hand ledger** per shop: every rupee in and out, with the arithmetic. After EACH flow: read the
chorus, check the 10 laws, reload, export the CSVs. A flow passes only when the ledger and every screen agree.

| # | Flow | Steps (as a shopkeeper would) | Must hold at the end |
|---|---|---|---|
| F1 | Set up | Settings: tax (exclusive, then try inclusive on a copy item), cash rounding, "shift required", day turns at 05:00, delivery fee; staff + PINs; categories; 15 items (sizes, a carton of 12 with its own price, loose kg, a tier "3+ at …") | Every setting saved shows after reload; nothing appears in any money report yet (all 0) |
| F2 | Buy stock | Supplier → PO → receive part (one carton line, one short line) → pay part naming the PO → receive the rest → pay on account | Cost per piece = carton ÷ 12; average cost weighted; supplier balance = received − paid; Stock value = Σ qty × avg cost |
| F3 | Open the day | Each cashier opens a shift with a float at their own lane | Drawer panel = float; Day & banking lists both shifts |
| F4 | Sell | 25+ bills: cash with change, card, transfer, split of 3, khata, carton, loose 0.375 kg, size, tier, line discount, bill discount at and past the ceiling (PIN), coupon, promotion, bank offer, tip | Each bill: Σ tenders = total, tax on the charged amount; Sales list = Day "Rung up" = Reports revenue = Dashboard today |
| F5 | Khata | Credit sale, part payment at the till, overpay → advance, use the advance, a payment from the customer page | Customer balance = Σ credit − Σ paid on card, statement, Owed to you, Ledger; payments are never revenue |
| F6 | After the sale | Return part of a discounted taxed line (cash refund, PIN); exchange for dearer and for cheaper; **void** as cashier (needs PIN) the same day, then try the next day (refused); **Add to this bill** (from the sheet AND from Sales later); **Re-ring** bigger (take the difference), smaller (hand back cash), a card bill smaller (refused), a bill with a return (refused) | Revenue, tax, cost of goods and stock drop by exactly the returned share; exchanges are not refunds; a re-rung bill is Cancelled "Re-rung as …" and counted once; the drawer moves only by real cash |
| F7 | Quotes, advances, instalments | Quote → hold on advance with a deposit → pay more → bill & hand over; one lapses; sell on 3 instalments with a charge, take one instalment | Each paisa paid appears once in a drawer/day; the sale counts once, at hand-over; instalment columns ("1 of 3 months", "on the 16th") match the plan |
| F8 | Expenses & income | Expense from the drawer, from the bank, a recurring one; other income | Once each in Expenses/Income, Cashbook, Ledger, Reports; a drawer expense lowers expected cash |
| F9 | Stock moves | Adjust (+/−), stocktake one category, dispose a damaged item, transfer Main → Outlet and receive it | Valuation only changes by adjust/dispose; a transfer moves value, never changes it; item history balance = shelf |
| F10 | Offline | Put a till offline: ring 3 sales (one carton), sync; let one be refused and settle it | After sync: same totals as if rung online; the carton keeps its price; refused slip settled once |
| F11 | Close | Close each shift with a count (one short by 50), close the day, bank a deposit | Variance −50 exactly; Day total by method = Σ its shifts; banked leaves "still in the shop" |
| F12 | Next morning | Ring 2 sales; read Reports for yesterday, today and the 2-day range; Dashboard "compared with yesterday" | Days add up to the range; nothing from yesterday moved into today |
| F13 | Edit and delete (CRUD) | Change an item's price (old bills keep theirs); delete an item that was sold; rename a category; edit an expense amount, then delete it; edit an income; edit a customer's phone; cancel a PO that has a payment; change a staff member's permissions mid-shift | **After each one, re-read every report**: only what the edit names changes, everything else stays to the paisa; deleted things leave history intact |
| F14 | Two places | Repeat 5 sales and an expense at the Outlet | Each report on "All branches" = Main + Outlet, line by line |
| F15 | Café only | Dine-in: open tabs on 2 tables, send to kitchen, split a bill, takeaway order, close tabs | Kitchen gets every item once; tab totals = bills; floor and reports agree |

## 3. Re-test the fixed list

Run every row **R36–R73** in `docs/qa/TESTER-BRIEF.md` (the fixer's re-test table). Each: PASS / FAIL with
one line of proof (invoice number, figure, screenshot name).

## 4. Also look at (not money, but the owner sees it)

- Settings: Delivery fee is under Tax & Delivery; Point of Sale has Counter / Lanes & PINs / Devices & offline / Quotes & advances / Kitchen; long device lists show 5 + "Show all".
- Every list screen: the same tabs, status pills and search bar look (design audit 2026-10-18).
- A phone (390 px) for the till, Sales, Quotes & advances, Customers, Day & banking.

## 5. Do not report again

Known and parked (online orders work, a later version): **B17, B34, B36, B37, B83, B87, B88, Q16, Q17**.
Not built yet: branch-wise products/categories (Q20–Q23). Waiting on the owner: **Q4**. HR is out.
If one of these now behaves differently, one line under "Known bugs that changed".

## 6. Priorities

As in the money brief: **P0** money or stock counted twice or lost, or one shop sees another's;
**P1** any wrong figure, or a permission that leaks money; **P2** screens disagree on words or grouping;
**P3** looks, words, speed.

## 7. When to stop

Do F1–F14 in the Mart first (that is the core). Then F1, F4, F6 and F11 in Clothing; then F1, F4, F11
and F15 in the Café. If the chat is running out, finish the flow you are in, write it up, and say in the
report which flows are left.

## 8. The report

**Path: `docs/qa/TESTER-REPORT-2026-10-18-full-retest.md`** (do not commit it; if it runs past today,
keep this file and continue in it). Write after EACH flow, in this order:

1. **Header**: the three commits, shops and people (no passwords), UI / API / Playwright used.
2. **Summary**: `F | shop | PASS / FAIL / BLOCKED / NOT TESTED | one line` for each flow; the 10 laws
   PASS / FAIL per shop; R36–R73 count passed / failed; new bugs `ID | P | area | one line` with IDs
   `#1, #2…` (the fixer gives them B numbers); known bugs that changed, or "none".
3. **The ledger** per shop: `action | figure | expected (arithmetic) | each place read → value | PASS/FAIL`.
4. **Each bug**: who, which screen · steps · expected (worked out) · actual in each place · proof
   (invoice / PO numbers, the request and answer) · cause `file:line` if found · fix direction (not done).
5. **Not tested, and why.**

When done, tell the user the report's path.
