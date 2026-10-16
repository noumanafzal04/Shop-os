# Goods go home on installments (F1) — and an installment is never taken twice

**Date:** 2026-10-16 · **Asked by:** the owner (2026-10-15), Q12–Q15 left to "market standard"
**Pushed:** backend `f6454cb`, panel `eac6a67` · **Migration:** `2026_10_16_000001_a_customer_can_pay_in_installments` (run on deploy; already run on dev)

## What the owner asked

"Bht sary person ko installment py cheezein dy skta — kitne months ki installment, duration, monthly kis din dy ga
— yahan highlighted ho, or in calculations sahi chal rhi ye b dekhna, or jahan jahan link wahan b." Then: "filters b
achy sy lga den … record sahi save ho rhy hon, show b — paison ka mamla hai, ghalat entry na ho."

## The rules (each one has a test)

| Rule | Where |
|---|---|
| The goods go out today as ONE sale at the cash price — counted in Sales and Reports today, stock off today. The price is the sale path's own (`quote_only` → `SaleQuoted`), never the screen's. | `StartInstallmentPlanAction` |
| The advance is that sale's payment; the rest is the customer's khata (`credit`). A plan is agreed on its own terms and is NOT held to the everyday khata limit (Q14) — only the internal `installment_plan` flag says so; no request can. | `CreateSaleAction` → `chargeCredit(heldToLimit: false)` |
| A markup (Q13) is never hidden in the item price: its own "Installment charge · INS-…" on the same khata and sale, and the shop's Other income that day. The sale and its tax stay the cash price. | same |
| Monthly = financed ÷ months rounded UP to a rupee; the last month takes the rest (to the paisa when whole rupees cannot fit). Advance + every month = the bill exactly. | `InstallmentSchedule::split` |
| Due dates: the first, then the same day each month; a 31st is the short month's last day and comes back after it. | `InstallmentSchedule::dueOn` |
| Every installment is a khata payment against the plan's sale — the khata, the plan and a later return read the same rows. It fills the OLDEST month first. More than is left is refused (`INSTALLMENT_EXCEEDS_LEFT`). | `TakeInstallmentAction` |
| **To collect** (due now) = what is late + the next month once it falls due within a week (SOON_DAYS 7). A customer who paid ahead is "Up to date" — never shown a sum to take. | `InstallmentSchedule::standing` |
| **Due this month** = what falls due from today to the month's end. What is late is counted under Late, never twice; the tile opens exactly those plans (`status=this_month`). | `InstallmentPlan::owedThisMonth`, `scopeDueThisMonth` |
| **Collected** = installments paid in. Goods coming back (`return` / `cancellation`) take the debt down but are not money: the plan shows "Installments paid" apart from "Goods returned", and the month's Collected leaves them out. | `InstallmentPlanController::show/summary` |
| Goods returned or the sale cancelled: the khata is reversed only by what is still owed; a plan cleared that way is CLOSED and its installment charge leaves income. | `InstallmentPlan::refreshStanding` |
| One press, one record: `once` on both POSTs, and behind it the sale's own key brings back the same sale and so the same plan. | `AnswerOnce`, replay guard |
| Starting a plan needs today's shift where the shop asks for shifts, however the advance is paid — the goods leave on a counter sale. A refused plan writes nothing. Cash taken against any khata needs today's shift too (L18). | `CreateSaleAction`, `TakeKhataPaymentAction` |

## The wrong entry this closes

A customer paying installments could hand money over at their card's **Take payment**. It came off the khata but not
off the plan: the plan kept saying "late" for money already in the drawer, and taking it again on the plan would have
put it in the drawer twice. Now the card asks first — "Is this an installment?" — with a Yes per running plan (refused
past what is left) and "No — on the khata". The statement names the plan on its lines (On installments · Installment
charge · Installment · Cash) instead of "Credit sale" twice and "Paid".

## Screens

- Quotations & advances → **On installments**: tiles (Out · Late · Due this month · Collected this month, each opening
  its own list), filters with counts (Running · Late · Due this week · Due this month · Paid off · Closed · All plans),
  search by plan, customer, phone, bill or item, rows red/amber/green, a coloured **To collect** column.
- A plan: the terms, Installments paid / Goods returned, month by month (late red, due amber, paid muted), Take
  installment with one-press amounts (Up to date · One month · All that is left) and "After this, X is left" /
  "This pays INS-… off" before the press, every payment with who took it.
- Customers: plans on the card, On installments / Late installments filters, the question above.

## Not done (known)

Selling on installments from the till; a printed receipt per installment; a part return does not reduce the markup;
a customer's existing khata advance is not applied to a new plan (it stays on the khata as their advance).

## Proof

`GoodsGoHomeOnInstallmentsTest` (16) + `InstallmentScheduleTest` (4). Backend mutations: 9 when built, 9 more after
the money review — all caught (one survived at first, the replay guard, because `once` answered first; a test without
`once` now holds it). Panel (KhataBox, InstallmentsTab, StartInstallmentModal, khata): 3 when built, 6 more — all caught. Walk `panel/e2e/qa-kit/p6-installments.mjs`
on Zari (copy stack): 24 checks reading the sale, khata, income, plan, drawer, day and report after every step — all PASS.
