# Khata, advances and installments — the flow (2026-10-15, BUILT 2026-10-16)

Status: **all five parts built and pushed** (2026-10-16). Q12–Q15 were left to "market standard" and the
recommended answers taken. What was built, rule by rule, and what differs from this proposal:
`docs/decisions/shopos-goods-go-home-on-installments.md` (part 5) and
`docs/decisions/shopos-a-khata-payment-asks-before-keeping-an-advance.md` (parts 1–4). Not built from part 5:
selling on installments from the till (it starts from Quotations & advances only), a printed receipt per
installment, late fees and SMS (Q15).

Asked by the owner on 2026-10-15, from Ali Raza's khata screen:

- Does a khata payment show in sales, and is it counted in the reports?
- Customers: a filter for the people who are on khata, and the ones who owe money marked in the row.
  Today they are mixed in with everyone else.
- Quotations & advances: an advance with installments running cannot be followed — it is all mixed.
  The shop gives goods on installments to many people. It needs the number of months, the monthly
  amount and the day each month it is due. Make those stand out, add coloured "to collect" columns and
  filters, and check the calculations.
- Everything that should link somewhere links there.

---

## What the code does today (checked 2026-10-15)

| Thing | Today | Problem |
|---|---|---|
| Credit sale (INV-000005, 4,227.30 on khata) | Counted in Sales, Reports and profit **on the day it was rung**, at the full amount. The customer's khata goes up by 4,227.30. | None. This is right. |
| Khata payment (4,250 by Transfer) | Not a sale, so it is not counted again. That is right. Cash goes into the drawer (`khata_in`) and so reaches the day close. | **Transfer, card and wallet payments show up in no report and not in Day & banking.** They appear only on the customer's own statement. (L14) |
| Paying more than is owed | The server refuses: "Payment exceeds the 4,227.30 still owed. Confirm to keep the extra 22.70 as an advance." | **The screen has no Confirm button.** The message says "Confirm", but the shop cannot record 4,250 at all. (L13) |
| Balance after an advance | `credit_balance` goes to −22.70, and the next credit sale uses it up automatically. | The card shows "Rs −22.70 owed" and hides the Record box. (L15) |
| Statement lines | "Payment (bank_transfer)" and "Credit sale". | Raw method names, and no link to the invoice. (L15) |
| Customers list | Columns: Customer, Phone, Sales, Spent. | **No "Owes" column and no filter.** The dashboard's "Owed to you" tile opens the plain list. (L16) |
| On advance (layaway) | Goods stay **held in the shop** until paid off. Any amount, any time. Shows Total / Paid / Balance / Collect by. | No plan (months, monthly amount, due day). No last-payment date, no colours, no "fully paid — hand over" filter. (L17) |
| Installments (qist) | **Do not exist.** The nearest things are a layaway, where the goods stay in the shop, and khata, which has no schedule. | The feature to build (F1). |

---

## Part 1 — Paying khata (L13, L15)

```
┌ Ali Raza · 0300-01241234 ──────────────────────────────┐
│ CREDIT (KHATA)          Owes Rs 4,227.30 / 10,000 limit │
│ [ 4250        ] [Transfer ▾] [Take payment]             │
│                                                         │
│  ┌ Ali Raza owes 4,227.30. You entered 4,250. ───────┐  │
│  │ [Keep 22.70 as advance]   [Take 4,227.30 only]     │  │
│  └────────────────────────────────────────────────────┘  │
│                                                         │
│ 15 Oct · Credit sale  INV-000005 →          + 4,227.30  │
│ 15 Oct · Paid · Transfer                    − 4,250.00  │
│ Balance: Advance 22.70 (in their favour)                │
└─────────────────────────────────────────────────────────┘
```

- When the amount is more than is owed, the screen asks **before** sending. "Keep as advance" sends
  `allow_advance`. "Take … only" changes the amount to what is owed.
- A balance below zero reads **"Advance 22.70 — in their favour"**, in green, never "−22.70 owed". The
  payment box stays open, so an advance can also be taken from a customer who owes nothing (this goes
  through the same confirm).
- Statement lines use people's words ("Paid · Transfer"). A credit sale links to its invoice.

## Part 2 — Customers: who owes money (L16)

```
 Owed to you: Rs 1,84,500 across 23 customers · Advances held: Rs 2,300 (3)

 [All 412] [Owe money 23] [Over / near limit 4] [Advance 3] [On installments 9] [Late installments 2]

 Customer          Phone          Owes            Limit         Last paid        Spent
 Ali Raza          0300-0124…     Rs 4,227  ▮▮▯   10,000 (42%)  never            Rs 4,227   [Take payment]
 Bilal Traders     0321-…         Rs 52,000 ▮▮▮   50,000 OVER   38 days ago      Rs 3,10,000 [Take payment]
 Sana              0333-…         Advance 500                   2 days ago       Rs 9,800
```

- An **Owes** column. Red when the customer owes, with a small bar against the limit. A red **OVER** tag
  above the limit, amber from 80%. "Advance …" in green when the shop holds their money.
- **Last paid** in the shop's own date style, as "38 days ago". Over 30 days is amber.
- Filter chips with counts:
  - All
  - Owe money (sorted largest first)
  - Over / near limit
  - Advance held
  - On installments and Late installments (once Part 5 exists)
- A summary line at the top. The dashboard's **Owed to you** tile opens this list with **Owe money**
  already selected (`/tenant/customers?owing=1`).
- **Take payment** right in the row, which opens the Part 1 box.
- Export CSV keeps the chosen filter.

## Part 3 — Where collected money shows (L14)

- **Day & banking** gets a "Collected on khata & installments" block, split by method: cash (already in
  the drawer), transfer, card and wallet. Each line links to the list of those payments.
- **Reports** gets a "Collections" figure beside Sales. It is not added to sales or profit. It answers
  "what came in today against old bills".
- The rule, written once: **a sale is counted on the day the goods go out; money received later against
  it is a collection, never a sale again.**

## Part 4 — On advance (layaway) list (L17)

```
 [Open] [Overdue] [Not paid 30+ days] [Paid up — hand over] [Collected] [Cancelled]

 Number    Customer        Items        Total     Paid              Left        Last paid     Collect by
 LAY-0004  Ahmed (call)    Fridge …     90,000    ████▒▒ 60,000 67% 30,000      3 days ago    30 Oct
 LAY-0002  Nadia (call)    Sofa         45,000    ██████ 45,000     PAID UP → Hand over         —
 LAY-0001  Kamran          Bed          60,000    █▒▒▒▒▒ 10,000     50,000      41 days ago   12 Oct LATE
```

- **Left** is the bold, coloured column: amber while open, red when past "Collect by", green **PAID UP →
  Hand over** when nothing is left.
- **Paid** shows a progress bar and a %. **Last paid** shows a date, amber after 30 days.
- The filters above, each with a count. The tiles at the top are clickable and set the filter.

## Part 5 — Installments, qist (F1 — BUILT 2026-10-16, from Quotations & advances; not from the till)

### Setting one up

At the till, Pay → **On installments**, or from Quotations & advances → **Sell on installments**. A quotation
can also be billed on installments.

```
┌ Sell on installments ───────────────────────────────┐
│ Customer *   Ali Raza · 0300-01241234  (on file ✓)  │
│ Bill         Rs 60,000  (+ markup 10% = 6,000) → 66,000 │  ← Q13
│ Advance now  Rs 16,000   [Cash ▾]                    │
│ Months       [ 10 ]                                  │
│ Monthly      Rs 5,000   (last month 5,000)           │
│ First due    15 Nov 2026 → then the 15th of each month│
│ ─────────────────────────────────────────────────── │
│ 16,000 now + 10 × 5,000 = 66,000 ✓                   │
│                      [Cancel]  [Hand over & start plan] │
└──────────────────────────────────────────────────────┘
```

What happens when it is saved (recommended: Q12 = goods go out now):

1. One **sale at the full bill**. It counts in Sales and Reports today, like a credit sale, and the stock
   goes out today.
2. The **advance** is that sale's payment. Cash goes into the drawer and needs today's shift, the same as
   L2.
3. The **rest goes on the customer's khata**, tied to the plan. "Owed to you" includes it, because the
   customer does owe it.
4. A **plan**: months, monthly amount, first due date and due day. The schedule is worked out from these
   and never typed in.

### The calculations (each will have a test)

- **Monthly** = (bill − advance) ÷ months, rounded **up** to a whole rupee. The **last** month takes the
  rest, so advance + all months = bill **exactly**.
- **Due dates**: the first due date, then the same day each month. A 31st becomes the last day of a short
  month. The date is the shop's day (the 05:00 rule).
- **Due so far** = the sum of the months whose due date has come.
- **Paid** = every payment against the plan. It fills the **oldest month first**, so a part payment leaves
  that month "Part".
- **Late** = due so far − paid, when above zero. "Late 2 months · Rs 10,000".
- **Left** = bill − advance − paid. Paying ahead moves the next due date forward. Paying more than is left
  goes through the Part 1 advance confirm.

### Following them — Quotations & advances → new tab **On installments**

```
 Out on installments Rs 4,20,000 · Due this month Rs 65,000 · Late Rs 18,000 (3) · Collected this month Rs 40,000

 [Running 9] [Due this week 3] [Late 3] [Paid off] [Cancelled]      Search name / phone / number

 Plan     Customer        Item        Bill     Paid               Left     Monthly  Next due              
 INS-0007 Ali Raza (call) Fridge      66,000   ███▒▒▒ 3 of 10     35,000   5,000    15 Nov · in 3 days   (amber)
 INS-0003 Kamran (call)   LED 43"     48,000   █▒▒▒▒▒ 1 of 8      36,000   4,500    LATE 2 months 9,000  (red row)
 INS-0001 Nadia           Sofa        45,000   ██████ 6 of 6       —        —       PAID OFF             (green)
```

- **Red row** = late. **Amber** = due within 7 days. **Green** = paid off. The tiles set the filters.
- **Take installment** in the row. The amount is pre-filled with what is due now (late + this month), it can
  be changed, and it prints a receipt on the shop's paper.
- **The plan's own page** shows:
  - a month-by-month table (due date, amount, paid, and Paid / Part / Due / Late)
  - every payment
  - links to the sale (INV) and to the customer
- The customer list's "On installments" and "Late installments" chips are these same plans.

## Links (everywhere a thing is named, it opens)

| From | Opens |
|---|---|
| Dashboard "Owed to you" | Customers, filtered to "Owe money" |
| Customer statement: credit sale, history INV | The sale |
| Customer card | Their plans and advances |
| Plan or advance row: customer, INV | The customer card; the sale |
| Day & banking: collected by method | The list of those payments |
| A layaway or quotation billed | The sale it became, both ways |

## Build order (each part pushed as it passes the gates)

1. Part 1: the overpay confirm, advance wording, statement words and link (L13, L15). Small; a bug.
2. Part 2: the customers' Owes column, filters, summary, dashboard link (L16).
3. Part 3: collections in Day & banking and Reports (L14).
4. Part 4: the On advance list (L17).
5. Part 5: installments (F1), after the answers below.

## Questions for the owner

| Q | Question | Recommended |
|---|---|---|
| Q12 | On installments, do the goods go home **now**, with the advance and then monthly payments? Or do they stay in the shop until paid off? (That second case is "On advance" today.) | **Now.** That is how qist works. On advance stays as it is for goods held. |
| Q13 | Is the installment price the cash price, or higher (markup)? | An optional **markup %** per plan, shown on the bill as its own "Installment charge" line. Default 0. |
| Q14 | Does a plan count against the customer's khata credit limit? | **No.** A plan is approved on its own, and only staff allowed to sell on credit can start one. |
| Q15 | A late fee, or an SMS reminder before the due date? | **Not now.** Late is shown in red. A reminder can come later (SMS sender "CartZe" exists). |
