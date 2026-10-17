# Tester report — money, every paisa (2026-10-16)

Brief: `docs/qa/MONEY-TEST-BRIEF.md`. **Test only** — no code changed, nothing committed.

## 1. Header

| | |
|---|---|
| backend | `aa660f4` |
| panel | `f059d4a` |
| repo (root) | `ac095e3` |
| Stack | panel `http://localhost:5177`, API `http://localhost:8000/api/v1`, DB `shopos` (dev) |
| How | shops/catalog/staff built through the **API**; every money action driven in the **UI with Playwright** (qa-kit); every figure read back from the **API** and from each screen |
| Walk scripts | `panel/e2e/qa-kit/.money-*.mjs` (dot-prefixed, uncommitted) |

### Shops made for this pass (both from the platform admin, Enterprise plan, every module but `hrm`/`fuel`)

| Shop | Trade | Branches | Settings that matter |
|---|---|---|---|
| **Paisa QA Mart** | mart, Lahore | Main, Township | tax 17% **exclusive**, `pos_require_shift` on, `cash_rounding` 0, loyalty on (1 pt / Rs 100, 1 pt = Rs 1, min 100), discount ceiling 10% / Rs 500, layaway + installments on, day turns at 05:00 |
| **Paisa QA Kitchen** | food, Karachi | Main | same, plus tips on |

### People (passwords are in `docs/qa/LOGINS.local.md` style — not written here)

Mart: owner `owner@paisaqa-mart.test` · cashier `cashier@paisaqa-mart.test` · shift supervisor `super@paisaqa-mart.test` ·
stock keeper `stock@paisaqa-mart.test` · accounts `accounts@paisaqa-mart.test` · manager `manager@paisaqa-mart.test` ·
purchasing `buyer@paisaqa-mart.test` · Township cashier `twncashier@paisaqa-mart.test`.
Kitchen: owner `owner@paisaqa-kitchen.test`.

### Catalog (Paisa QA Mart) — awkward prices on purpose

| SKU | Item | Price | Cost | Tax | Note |
|---|---|---|---|---|---|
| QA-BESAN | Besan Pack 1kg | 333.33 | 240.50 | 17% shop | plain |
| QA-DAAL | Loose Chana Daal | 1,240.00 /kg | 980.00 | 17% shop | sold by weight |
| QA-COLA | Cola 250ml | 68.75 | 50.00 | 17% shop | + unit "Carton of 12" @ 787.50 |
| QA-GHEE | Ghee Tin 2.5kg | 1,999.00 | 1,500.00 | 17% shop | sale price 1,849.25 |
| QA-RICE | Rice Bag 5kg | 2,999.99 | 2,300.00 | 17% shop | tier: 10+ @ 2,850.00 |
| QA-MILK | Fresh Milk 1L | 212.50 | 180.00 | **0%** group | other tax group |
| QA-YOG | Yogurt 500g | 149.99 | 110.00 | **5%** group | other tax group |
| QA-ATTA | Atta Bag 5kg / 10kg | 1,150.75 / 2,225.50 | 900 / 1,760 | 17% shop | sizes |
| QA-TEA | Tea Pack 430g | 1,475.00 | — | 17% shop | no stock — for the two-purchase average-cost test |
| QA-SVC | Home Delivery Service | 250.00 | — | 17% shop | service |

## 2. Summary

| M | Area | Verdict | One line |
|---|---|---|---|
| M1 | Till sale | **FAIL $1** | every price exact to the paisa — weight, carton, size, tier, sale price, coupon, promotion, bank offer — but a **percent** line discount is charged as **rupees** |
| M2 | Tax | **FAIL $9** | exclusive tax is exact everywhere (two extra groups, 0 % and 5 %, tax on discounted lines, both modes read right by the Tax report); **inclusive** is exact at the counter **and offline**, and **wrong on every tab** |
| M3 | Paying | **FAIL $3** | exact cash, wallet, a three-way split and rounding 1/5/10 all exact; a rounded-**down** sale's **receipt** prints "Balance due" |
| M4 | Khata | **PASS** | credit sale, part-paid, up to and past the limit, a payment, an overpayment kept as an advance, the advance spent — every balance exact |
| M5 | Return / refund / exchange / void | **PASS** | a part return of a discounted taxed line pro-rated the discount **and** the tax exactly; both exchanges and the void exact |
| M6 | Shift and drawer | **FAIL $6** | both drawers counted out to the paisa (+0.34 and −5.00); a **refund may overdraw a drawer** silently while a pay-out is refused |
| M7 | Business day | **PASS** | the day is Σ of its two shifts in every figure; the deposit never touched a drawer; khata listed apart from sales |
| M8 | Quotations, advances, installments | **FAIL $7 $8** | every paisa paid in appears once and the sale is counted once at hand-over; but the **deposit floor** and the **installment bill/monthly** are quoted **before tax** |
| M9 | Purchases and suppliers | **PASS** | a box price divided by the box, a short line, a part payment, an order's Paid = Σ its allocations, balance = received − paid |
| M10 | Stock value and cost of goods | **PASS** | cost of goods = qty × the weighted average **at the moment of sale** (1,140.23); a transfer moved value without changing it |
| M11 | Expenses and income | **PASS** | each appears once in Cashbook, Ledger and Reports; a drawer expense lowered expected cash by exactly its amount; the no-shift case is **said out loud** |
| M12 | Reports and Dashboard | **FAIL $4 $5** | revenue, tax, cost of goods, profit and Dashboard-today all exact; the **Ledger's running balance is out of time order** and **Margins ignores bill discounts** |
| M13 | Loyalty | **PASS** | earned on goods net of the redemption, redeemed once, the tax charged on the reduced figure |
| M14 | Double press | **PASS** | Pay, Refund, supplier payment, Close shift, Close day, Deposit, Receive — one record each, no error after the success |
| M15 | Who sees money | **PASS** | a cashier gets `null`, not 0, and 403 on all eight reports; a stock keeper gets no money figure at all (its `cost` is a documented decision — see the note) |
| M16 | Restaurant | **FAIL $9 $10 $11** | the split (by items **and** by amount), the tip and the drawer are exact to the paisa; but a tab adds tax on top at an **inclusive** shop, fast repeat taps on a dish are **lost**, and the delivery fee reaches **no book** |
| M17 | Offline | **PASS** (one P3 — $12) | rung with the line out, the price changed behind its back, reconnected: kept at **499.00** — the price paid — exactly once, and Reports → Offline names both figures in a sentence. Its "which till" column is blank |
| M18 | Two branches | **PASS** | Main 118,612.06 + Township 1,169.99 = 119,782.05 on the Dashboard and in Reports; shelves and valuation add up |

### The ten laws

| # | Law | |
|---|---|---|
| 1 | Σ tenders = bill total; change = cash given − cash due | **PASS** (a bank offer's share reads Σ tenders + bank = bill, by design) |
| 2 | Sales list total = Day "Rung up" = Reports revenue | **PASS** — all three **98,978.25** before the later rows |
| 3 | Expected drawer = float + cash sales + cash collected + pay-ins − refunds − pay-outs − cash expenses | **PASS** on both shifts, to the paisa |
| 4 | Customer balance = Σ credit − Σ payments; statement = card = Owed to you | **PASS** |
| 5 | Supplier balance = Σ received − Σ paid; an order's Paid = Σ its allocations | **PASS** |
| 6 | Valuation = Σ (qty × average cost); cost of goods = qty × average cost when sold | **PASS** |
| 7 | Net profit; Σ daily series = totals; Dashboard today = Reports today | **PASS** — profit **6,802.88** both places |
| 8 | Branch figures add up to the whole shop | **PASS** |
| 9 | Money that is not a sale never changes Revenue or Profit | **PASS** — khata, advances, instalments and deposits all stayed out |
| 10 | Every figure is the same after a reload and in its CSV | **PASS** — all eight exports matched the API exactly |

### New bugs

| ID | P | Area | One line |
|---|---|---|---|
| **$1** | **P1** | Till / line discount | Choosing "Percent %" silently reverts to "Fixed amount", so 7.5 % is charged as **Rs 7.50** — INV-000007 overcharged **Rs 254.47** |
| **$2** | P3 | Till / cart row | A 7.5 % line discount is labelled "**8 %**" (`Math.round`) |
| **$3** | **P1** | Receipt | A rounded-**down** sale's receipt prints "**Balance due Rs 4.05**" when nothing is owed (every screen is right) |
| **$4** | P2 | Ledger | The running balance is carried down rows grouped by type, not in time order: it reads **−39,823.61** before the day's first sale |
| **$5** | P2 | Reports / Margins | Margins never apportions a bill discount — gross profit **17,259.82** vs Summary **16,834.82**, out by exactly the **Rs 425** of discounts |
| **$6** | P2 | Drawer / refunds | A refund may **overdraw** the drawer with no warning (expected cash **−1,509.99**), while a pay-out from the same drawer is refused |
| **$7** | P2 | Quotes & advances | The minimum deposit is stated **before tax** on screen (Rs 1,200) and enforced **after** on the server (Rs 1,404) |
| **$8** | **P1** | Installments | The sheet quotes bill **4,068.50** and monthly **1,190**; the plan is written at **4,760.25** and **1,421.00** — out by **Rs 691.75**, with no correction notice |
| **$9** | **P1** | Dine-in / tax | At a **tax-inclusive** shop a tab adds 17 % **on top**: the same dish is **1,799.00** at the counter and **2,104.83** at the table, and the "tax" is charged on a figure that already holds tax |
| **$10** | **P1** | Dine-in / ordering | Four taps on one dish within a second send **one** request — three are lost in silence, so food is served and never charged (B63's twin guard landing on a stepper) |
| **$11** | P2 | Delivery / riders | The **delivery fee** (149.99 of the 2,048.98 collected) is in no book of the shop, and "Cash received" from the rider moves **no** drawer, cashbook or income figure |
| **$12** | P3 | Reports → Offline | "Which till" is **blank** for every web till — `device?->name` is null while the device's `code` (**MJ83**, the one on the slip) is right there |

### Known bugs confirmed unchanged

**B18** (khata sale reads "Paid … Change Rs 0" and stores `amount_paid` = the total) · **B20** (khata cash
under "Cash in (paid in, float)") · **B28** (the till's button total ≠ Amount due with a bank offer, and the
Sale-complete sheet never names the offer — the **receipt** does) · **B65** (a saved quotation cannot be
turned into held goods) · **B21**'s shape on the drawer (an exchange's cash-back is booked as the
replacement sale's **change**, and the credit sits in `tender_mix` as **`other`** — `expected_cash` stays
right).

### Known bugs that changed

- **B25 / B26** (OPEN) describe the hand-over of a **part-paid** layaway. On one paid **in full** neither
  symptom appeared: the document read "Balance due **Rs 0**" correctly, all three payments were listed
  under PAYMENTS RECEIVED, and "Bill it" was **enabled without typing** ("This booking is paid in full —
  nothing to collect"). The part-paid path they are about was not reached, so this is not a re-test.
- **B14**'s second half ("a closed day still takes sales") did **not** reproduce on a shop that requires a
  shift: with the day closed off, opening a shift was refused — `409 BUSINESS_DAY_CLOSED`, *"Trading on
  2026-10-16 has already been closed off. A manager can open it again from Day & banking."* The
  no-shift-required case was not tested.

## 3. The ledger

*(each action: what was done · the figure · expected with the arithmetic · every place read · PASS/FAIL)*

### M1 — till sale, line pricing (cashier Kamran, Main, shift float Rs 7,350)

Shift `01a14515-f633…`, opened 2026-10-16, float 7,350.00. Every figure below was worked out by hand
first (the arithmetic is in the "expected" column), then read off the **cart row**, the **chip strip**
(Sub Total / Discount / Taxable / Tax / Grand Total), the **tender sheet**, the **Sale complete** sheet
and finally `GET /sales/{id}`.

| # | What was done | Expected (worked out) | Cart row | Chips | Tender due | Sale-complete | API | Verdict |
|---|---|---|---|---|---|---|---|---|
| S1 | Besan 333.33 × 3, cash 1,200 | gross 333.33×3 = **999.99**; tax 17% = 999.99×0.17 = 169.9983 → **170.00**; total **1,169.99**; change 1,200 − 1,169.99 = **30.01** | Rs 333.33 · Rs 170 · Rs 999.99 | sub 999.99 · tax 170 · GT 1,169.99 | Rs 1,169.99 | Total 1,169.99 Paid 1,200 Change 30.01 | subtotal 999.99 · tax 170.00 · total 1,169.99 · paid 1,200.00 · change 30.01 | **PASS** (INV-000001) |
| S2 | Loose Chana Daal **0.375 kg** × 1,240/kg, cash 600 | 1,240 × 0.375 = **465.00**; tax 465×0.17 = **79.05**; total **544.05**; change **55.95** | 0.375 · Rs 1,240 · Rs 465 | sub 465 · tax 79.05 · GT 544.05 | Rs 544.05 | 544.05 / 600 / 55.95 | subtotal 465.00 · tax 79.05 · total 544.05 · change 55.95 | **PASS** (INV-000002) |
| S3 | Cola **Carton of 12 ×2 @787.50** + **5 singles @68.75**, cash 2,300 | 2×787.50 = 1,575.00; 5×68.75 = 343.75; sub **1,918.75**; tax 1,918.75×0.17 = 326.1875 → **326.19**; total **2,244.94**; change **55.06** | line1 Carton of 12 · 787.50 · tax 267.75 · 1,575 — line2 68.75 · tax 58.44 · 343.75 | sub 1,918.75 · tax 326.19 · GT 2,244.94 | Rs 2,244.94 | 2,244.94 / 2,300 / 55.06 | subtotal 1,918.75 · tax 326.19 · total 2,244.94; line 1 `unit_factor 12`, price 787.50 | **PASS** (INV-000003) · Σ line tax 267.75+58.44 = 326.19 = bill tax |
| S4 | Atta Bag **size 10kg** ×3 @2,225.50, cash 7,900 | 3×2,225.50 = **6,676.50**; tax ×0.17 = 1,135.005 → **1,135.01**; total **7,811.51**; change **88.49** | 10kg · 2,225.50 · tax 1,135.01 · 6,676.50 | sub 6,676.50 · tax 1,135.01 · GT 7,811.51 | Rs 7,811.51 | 7,811.51 / 7,900 / 88.49 | subtotal 6,676.50 · tax 1,135.01 · total 7,811.51; `variant_name "10kg"`, price 2,225.50 | **PASS** (INV-000004) |
| S5 | Rice Bag ×12 — **tier 10+ @2,850** (shelf 2,999.99), cash 40,100 | tier price 2,850 × 12 = **34,200.00**; tax **5,814.00**; total **40,014.00**; change **86.00** | badge `bulk` · Rs 2,850 · 34,200 | sub 34,200 · tax 5,814 · GT 40,014 | Rs 40,014 | 40,014 / 40,100 / 86 | subtotal 34,200.00 · tax 5,814.00 · total 40,014.00 · `unit_price 2850.00` | **PASS** (INV-000005) |
| S6 | Ghee Tin ×2 at the **sale price 1,849.25** (shelf 1,999), cash 4,400 | 2×1,849.25 = **3,698.50**; tax 628.745 → **628.75**; total **4,327.25**; change **72.75** | Rs 1,849.25 · tax 628.75 · 3,698.50 | sub 3,698.50 · tax 628.75 · GT 4,327.25 | Rs 4,327.25 | 4,327.25 / 4,400 / 72.75 | subtotal 3,698.50 · tax 628.75 · total 4,327.25 · `unit_price 1849.25` | **PASS** (INV-000006) |
| S7 | Rice Bag ×1 @2,999.99, line discount **7.5 %** (type picked first, then the amount) | 2,999.99 × 7.5 % = 224.99925 → **−225.00**; taxable **2,774.99**; tax **471.75**; total **3,246.74** | −**Rs 7.50** · tax 508.72 · 2,992.49 | sub 2,999.99 · disc −**7.50** · taxable 2,992.49 · tax 508.72 · GT **3,501.21** | Rs 3,501.21 | 3,501.21 | subtotal 2,992.49 · `line_discount 7.50` · tax 508.72 · total 3,501.21 | **FAIL → $1** (INV-000007, customer overcharged **Rs 254.47**) |

Tax on a discounted line (part of M2) is **right** wherever the discount itself is right: S7's tax was
charged on the amount actually charged (2,992.49 × 0.17 = 508.72), and in the re-probe where the percent
did hold, on 2,774.99 × 0.17 = **471.75**. Σ (line_total × tax_rate) = the bill's `tax` on every sale above.

Two notes on how the server stores a sale (not bugs, needed to read the laws right):
`subtotal` is Σ `line_total` and is already **net of line discounts**; the sale's own `discount` field
carries only the **bill** discount. So "bill = Σ lines − discounts + tax" reads as
`subtotal − discount + tax = total`.

### M1 continued — bill discount, the cashier's ceiling, coupon, promotion, bank offer

| # | What was done | Expected (worked out) | Chips | Tender | Receipt (`/invoice`) | API | Verdict |
|---|---|---|---|---|---|---|---|
| S8 | Besan ×6, **bill discount Rs 200** — the shop's ceiling is 10 % / Rs 500, and 10 % of 1,999.98 = 199.998, so 200 is **at** it | gross **1,999.98**; −200 → taxable **1,799.98**; tax ×0.17 = 305.9966 → **306.00**; total **2,105.98**; cash 2,200 → change **94.02** | sub 1,999.98 · disc −200 · taxable 1,799.98 · tax 306 · GT 2,105.98 | Rs 2,105.98 · change 94.02 | Subtotal 1,999.98 · Discount −200.00 · Sales tax +306.00 · Total 2,105.98 · Cash 2,200.00 · Change 94.02 · "You saved Rs 200.00" | subtotal 1,999.98 · discount 200.00 · tax 306.00 · total 2,105.98 · paid 2,200 · change 94.02 | **PASS** (INV-000008) |
| S9 | Same cart, **bill discount Rs 250** — 250 / 1,999.98 = **12.5 %**, past the 10 % ceiling | **refused**, no sale written | sub 1,999.98 · disc −250 · taxable 1,749.98 · tax 297.50 · GT 2,047.48 — the till lets it be typed | Complete pressed → `403 DISCOUNT_LIMIT_EXCEEDED`, on screen: *"Sale failed — This discount is 12.5 % — above the 10 % limit. A manager has to approve it."* | — | **no sale exists** | **PASS** — the ceiling holds on the server and the cashier is told why. Soft spot (P3, not filed): the discount sheet accepts 250 with no warning, so the cashier only finds out at the press |
| S10 | Besan ×6, **coupon QA7HALF** (7.5 %, min spend 1,000, cap 500) | gross 1,999.98 × 7.5 % = 149.9985 → **−150.00**; taxable **1,849.98**; tax 314.4966 → **314.50**; total **2,164.48**; cash 2,200 → change **35.52** | sub 1,999.98 · disc −150 · taxable 1,849.98 · tax 314.50 · GT 2,164.48; sheet said "QA7HALF · −Rs 150" | Rs 2,164.48 · change 35.52 | Discount **(QA7HALF)** −150.00 · tax +314.50 · Total 2,164.48 · "You saved Rs 150.00" | subtotal 1,999.98 · discount 150.00 · `coupon_code QA7HALF` · tax 314.50 · total 2,164.48 | **PASS** (INV-000009) |
| S11 | Yogurt ×4 — **automatic promotion** "QA Yogurt 12.5 % off", item in the **5 % tax group** | gross 4 × 149.99 = **599.96**; 12.5 % = 74.995 → **−75.00**; taxable **524.96**; tax **5 %** = 26.248 → **26.25**; total **551.21**; cash 600 → change **48.79** | sub 599.96 · disc −75 · taxable 524.96 · tax 26.25 · GT 551.21 | Rs 551.21 · change 48.79 | "QA Yogurt 12.5 % off" −75.00 · tax +26.25 · Total 551.21 · "You saved Rs 75.00" (**once**) | subtotal 599.96 · discount 75.00 · `promo_discount 75.00` · `promo_name` set · tax 26.25 · total 551.21 · line `tax_rate 5.00` | **PASS** (INV-000010) — the promotion is counted **once**, and the item's own tax group beat the shop's 17 % |
| S12 | Rice ×1 on **card** + **QA Bank 10 %**, cap 750, min spend 2,000, credit cards, last 4 = 4417 | bill 2,999.99 + tax **510.00** = **3,509.99**; bank 10 % of 3,509.99 = 350.999 → **351.00** (cap 750 clear); the customer taps **3,158.99**; the **sale total stays 3,509.99** — the bank pays the rest | sub 2,999.99 · tax 510 · GT 3,509.99 | Amount due went 3,509.99 → **3,158.99**, "Bank offer pays −Rs 351" | Total 3,509.99 · Card 3,158.99 · "QA 10 % credit, cap 750 · **paid by the bank** Rs 351.00" · "You saved Rs 351.00" | subtotal 2,999.99 · tax 510.00 · **total 3,509.99** · `bank_discount 351.00` · `bank_card_offer_id` set · `card_last4 4417` · paid **3,158.99** · change 0 · payments: card 3,158.99 | **PASS on every figure** (INV-000012). Σ tenders 3,158.99 + bank 351.00 = bill 3,509.99 |

Two things about S12 that are **already known** (B28, OPEN) and still behave the same way: the button
reads "Complete sale · Rs 3,509.99" while Amount due reads Rs 3,158.99, and the **Sale complete** sheet
("Total 3,509.99 · Paid 3,158.99 · Change 0") never names the bank offer. The **receipt does** name it.
Also noticed, and not a money bug: the card type defaults to **"Not sure"**, and with "Not sure" the
server quotes **0** — a cashier who does not press *Credit* simply charges full price, and the row says
"Nothing applies to this sale."

Observation (P3, not filed): every `GET /sales/{id}/invoice` counts as a print, so reading a receipt back
three times made the third copy print "**Reprint · Copy 3**" on a receipt nobody printed.

### M3 — paying

| # | What was done | Expected (worked out) | Tender sheet | Sale-complete | Receipt | API | Verdict |
|---|---|---|---|---|---|---|---|
| P1 | Besan ×3 (1,169.99), **exact cash 1,169.99** | paid 1,169.99, change **0.00** | due 1,169.99 · "Change due Rs 0" | 1,169.99 / 1,169.99 / 0 | — | paid 1,169.99 · change 0.00 · payments: cash 1,169.99 | **PASS** (INV-000013) |
| P2 | Milk ×7, **wallet** — item in the **0 % tax group** | 7 × 212.50 = **1,487.50**; tax **0.00**; total **1,487.50** | due 1,487.50 | 1,487.50 / 1,487.50 / 0 | — | subtotal 1,487.50 · **tax 0.00** · total 1,487.50 · method wallet | **PASS** (INV-000014) |
| P3 | Rice ×1 (3,509.99) **split three ways**: cash 1,500 + card 1,000 + **transfer 1,009.99** | Σ tenders = **3,509.99** exactly; change 0; only the 1,500 reaches the drawer | split rows summed, sheet said "Change Rs 0" | 3,509.99 / 3,509.99 / 0 | Cash 1,500.00 · Card 1,000.00 · Bank transfer 1,009.99 | payments: cash 1,500.00 + card 1,000.00 + bank_transfer 1,009.99 = **3,509.99**; `payment_method split` | **PASS** (INV-000015) |
| P4 | Bill **544.05**, `cash_rounding` = **1** | nearest 1 = **544.00**; adjustment **−0.05** (≤ 1) | AMOUNT DUE **Rs 544** · "Bill Rs 544.05 · Rounded to nearest Rs 1 **− Rs 0.05**" | Total 544.05 Paid 544 Change 0 | Total 544.05 · **Rounding − Rs 0.05** · To pay 544.00 · Cash 544.00 · **"Balance due Rs 0.05"** | total 544.05 · `rounding_adjustment -0.05` · paid 544.00 · change 0.00 | money **PASS**, receipt **FAIL → $3** (INV-000017) |
| P5 | Bill **544.05**, `cash_rounding` = **5** | nearest 5 = **545.00**; adjustment **+0.95** (≤ 5) | AMOUNT DUE **Rs 545** · "Rounded to nearest Rs 5 **+ Rs 0.95**" | Total 544.05 Paid 545 Change 0 | Rounding + 0.95 · To pay 545.00 · Cash 545.00 (no false balance — paid > bill) | total 544.05 · `rounding_adjustment 0.95` · paid 545.00 · change 0.00 | **PASS** (INV-000018) |
| P6 | Bill **544.05**, `cash_rounding` = **10** | nearest 10 = **540.00**; adjustment **−4.05** (≤ 10) | AMOUNT DUE **Rs 540** · "Rounded to nearest Rs 10 **− Rs 4.05**" | Total 544.05 Paid 540 Change 0 | Rounding − 4.05 · To pay 540.00 · Cash 540.00 · **"Balance due Rs 4.05"** | total 544.05 · `rounding_adjustment -4.05` · paid 540.00 · change 0.00 | money **PASS**, receipt **FAIL → $3** (INV-000019) |

`cash_rounding` was put back to **0** afterwards. Rounding never moved the bill by more than the step,
it always rounded to the **nearest** step, and the difference is named on the tender sheet and stored in
`rounding_adjustment`. **Note for M12**: the drawer counts the **rounded** cash while revenue counts the
**bill** — Σ adjustments on this shift is −0.05 + 0.95 − 4.05 = **−3.15**, which has to land somewhere in
the books; checked in M12.

Transfer as a **whole-bill** tender is not offered at the till (the five buttons are Cash / Card / Wallet /
Khata / Split) — a bank transfer can only be rung inside a **Split**. Recorded, not filed: it is a shape,
not a wrong figure.

### Drawer, checked by hand against every sale on the shift (M6, part 1)

`GET /pos/session/report` → `drawer`, after 19 sales:

| Figure | Server | Worked out by hand | |
|---|---|---|---|
| cash tendered | 69,943.99 | 1,200 + 600 + 2,300 + 7,900 + 40,100 + 4,400 + 3,600 + 2,200 + 2,200 + 600 + 1,169.99 + 1,500 + 545 + 544 + 545 + 540 = **69,943.99** | ✓ |
| change given | 666.33 | 30.01 + 55.95 + 55.06 + 88.49 + 86 + 72.75 + 98.79 + 94.02 + 35.52 + 48.79 + 0.95 = **666.33** | ✓ |
| cash sales | 69,277.66 | 69,943.99 − 666.33 = **69,277.66** | ✓ |
| expected cash | 76,627.66 | float 7,350 + 69,277.66 = **76,627.66** | ✓ |
| sales total | 79,798.28 | Σ the 19 bills = **79,798.28** | ✓ |
| tax | 11,324.67 | Σ the 19 tax figures = **11,324.67** | ✓ |
| tender mix | cash 69,943.99 · card 7,668.98 · wallet 1,487.50 · bank_transfer 1,009.99 | card = 3,509.99 + **3,158.99** (the bank offer's share is *not* counted as card) + 1,000 = **7,668.98** | ✓ |
| discounts | 425.00 | 200 (S8) + 150 (S10) + 75 (S11) = **425.00** — the S7 **line** discount of 7.50 is not in this figure | ✓ (bill discounts only) |

`GET /pos/session` returns the session **row**, whose `cash_sales` / `sales_count` / `expected_cash`
columns are only written at close and read **0** all shift. Not filed: `posService.ts` and
`shiftMirror.ts` say so in as many words, and every screen reads `/pos/session/report` instead.

### M4 — khata (credit)

Customers: **QA Khata Nasreen** (limit 20,000), **QA Khata Rafiq** (limit 5,000).

| # | What was done | Expected (worked out) | Till / Customers screen | Statement (screen) | API ledger (`balance_after`) | Verdict |
|---|---|---|---|---|---|---|
| K1 | Ghee ×1 @1,849.25 **on khata** | 1,849.25 + 17 % (314.3725 → **314.37**) = **2,163.62**; she owes **2,163.62** | tender sheet: "Adds Rs 2,163.62 to QA Khata Nasreen's khata"; card: **Owes Rs 2,163.62** of Rs 20,000 limit | "Credit sale · INV-000020 **+Rs 2,163.62**" | charge 2,163.62 → after **2,163.62** | **PASS** (INV-000020) |
| K2 | Rice ×1 (3,509.99) **part-paid**: cash 1,000 + khata 2,509.99 | Σ tenders **3,509.99**; she owes 2,163.62 + 2,509.99 = **4,673.61** | card: **Owes Rs 4,673.61** | "Credit sale · INV-000021 **+Rs 2,509.99**" | charge 2,509.99 → after **4,673.61** | **PASS** (INV-000021); payments: cash 1,000.00 + credit 2,509.99 |
| K3a | Rafiq, **up to** his 5,000 limit: Atta 5kg ×3 = 3,452.25 + tax **586.88** = **4,039.13** | allowed, he owes **4,039.13** | completed | — | charge 4,039.13 → after **4,039.13** | **PASS** (INV-000022) |
| K3b | Rafiq, **past** the limit: 1,346.38 more → 5,385.51 > 5,000 | **refused**; his balance unchanged | *"Sale failed — This sale would exceed the customer's credit limit (5,000.00)."* (`422 CREDIT_LIMIT_EXCEEDED`) | — | still **4,039.13**, no new row | **PASS** — nothing written |
| K4 | **Take Rs 2,000 cash** off Nasreen's 4,673.61 | 4,673.61 − 2,000 = **2,673.61**; drawer `cash_in` +2,000; **not** revenue | card: **Owes Rs 2,673.61** | "Paid · Cash **−Rs 2,000**" | payment 2,000.00 (cash) → after **2,673.61** | **PASS** |
| K5 | She hands over **Rs 3,000** against 2,673.61 — **Rs 326.39 too much** | the screen must ask; keeping it → **Advance Rs 326.39** (balance −326.39) | it asked: *"QA Khata Nasreen owes Rs 2,673.61. You entered Rs 3,000 — Rs 326.39 more. [Keep Rs 326.39 as advance] [Take Rs 2,673.61 only] [Change amount]"*; after: **Advance Rs 326.39 — "In their favour — their next credit sale uses it first"** | "Paid · Cash **−Rs 3,000**" | payment 3,000.00 (cash) → after **−326.39** | **PASS** |
| K6 | **Spend the advance** — Besan ×3 (1,169.99) on her khata | the 326.39 is absorbed → she owes 1,169.99 − 326.39 = **843.60** | completed | "Credit sale · INV-000023 +Rs 1,169.99" | charge 1,169.99 → after **843.60** | **PASS** (INV-000023) |

**Owed to you** (`/customers/summary`) after all of it: **owed 4,039.13 across 1 account** (Rafiq) and
**advance 326.39 across 1 account** (Nasreen) — an advance is listed on its own side, never netted into
"owed". Σ the rows with a non-zero balance = 4,039.13 and −326.39, which is exactly those two figures.
Earlier in the pass, with both owing, `owed.total` read **8,712.74** = 4,673.61 + 4,039.13. **Law 4 holds.**

**A khata payment is not a sale** (law 9, drawer half): after Rs 5,000 collected, `drawer.cash_sales`
was **unchanged** at 70,277.66, `cash_in` went **0 → 5,000**, expected cash 77,627.66 → **82,627.66**, and
the shift's movements list two `khata_in` rows of 2,000.00 and 3,000.00 reading "Khata payment · QA Khata
Nasreen". `tender_mix.credit` = 2,163.62 + 2,509.99 + 4,039.13 + 1,169.99 = **9,882.73** ✓.
The Reports/Dashboard half of law 9 is checked in M12.

Known bug confirmed unchanged: **B18** (OPEN) — a khata sale's sheet reads "Paid Rs 2,163.62 · Change
Rs 0" and the API stores `amount_paid` = the full total, though nothing was handed over.

Observation (P3, not filed): on K6 neither the tender sheet ("Adds Rs 1,169.99 to … khata") nor the
receipt ("On account (khata) Rs 1,169.99") says that Rs 326.39 of her own advance was absorbed, or what
she owes now. The arithmetic is right — her account moved by exactly 1,169.99 — but only the Customers
screen shows the 843.60 she is actually left owing.

Loyalty, for M13: points earn on **goods before tax, net of discount, floored** — INV-000020 subtotal
1,849.25 → **18**, INV-000023 subtotal 999.99 → **9**, her total 47 → **56**. One consistent rule;
`points_earned` on the sale = the receipt line = the customer card. (The brief words it as "amount
actually paid"; the shop's rule is the goods figure. Recorded as a definition, not filed as a bug.)

### M5 — return / refund / exchange / void

Done as **Saira Supervisor** (`sales.refund`, `sales.void`) on **her own second shift**, float **3,275.00**,
so every rupee out could be followed. She was not asked for an approval PIN — she holds the permission.

| # | What was done | Expected (worked out) | Sheet *before* the press | Stock | Drawer | API | Verdict |
|---|---|---|---|---|---|---|---|
| R1 | **Return 2 of the 6 Besan** on INV-000008 — a line that carried a Rs 200 bill discount and 17 % tax | goods 2 × 333.33 = **666.66**; discount share 200 × 666.66/1,999.98 = 200/3 = **66.67**; net **599.99**; tax 599.99 × 0.17 = 101.9983 → **102.00**; **refund 701.99** (cross-check: 2,105.98 ÷ 3 = 701.99 ✓) | "Goes back to the customer **Rs 701.99** incl. **Rs 102** tax" | Besan 39 → **41** (+2) | `cash_refunds` 0 → **701.99**; expected 3,275.00 → **2,573.01** (−701.99) | **RET-000001** total **701.99**, tax **102.00**, line net **599.99**, method cash; sale → `partially_refunded` | **PASS** |
| X1 | **Exchange for DEARER** on INV-000006: hand back 1 Ghee, take 1 Rice Bag | credit 1,849.25 + 17 % (314.3725 → 314.37) = **2,163.62**; out 2,999.99 + 510.00 = **3,509.99**; **collect 1,346.37** | "Credit for what comes back **Rs 2,163.62** · What goes out comes to **Rs 3,509.99** · **Difference to collect Rs 1,346.37**" | Ghee 37 → **38**, Rice 83 → **82** | `cash_tendered` **1,346.37**; cash_sales 1,346.37 − 701.99 = **644.38**; expected **3,919.38** | RET-000002 −2,163.62 (Exchange); replacement INV-000024 total 3,509.99 | **PASS** |
| X2 | **Exchange for CHEAPER** on INV-000004: hand back 1 Atta 10kg, take Besan ×2 | credit 2,225.50 × 1.17 = 2,603.835 → **2,603.84**; out 666.66 + 113.33 (666.66 × 0.17 = 113.3322) = **779.99**; **hand back 1,823.85** | "Credit … **Rs 2,603.84** · out **Rs 779.99** · **Hand back in cash Rs 1,823.85**" | Atta 10kg 17 → **18**, Besan 41 → **39** (2 out) | `change_given` **1,823.85**; cash_sales **−1,179.47**; expected **2,095.53** (= 3,919.38 − 1,823.85) | RET-000003 −2,603.84; replacement **INV-000025** total 779.99, payment `other` 2,603.84 ref "Exchange credit — return RET-000003", change 1,823.85; receipt says "**Exchange for INV-000004**" | **PASS** |
| V1 | **Void** INV-000013 (Besan ×3, 1,169.99, exact cash) with a coded reason | stock +3; the sale leaves revenue/tax/cost of goods **once**; the cash leaves the drawer it is handed back from | the sheet demanded a coded reason — Wrong item rung / Customer changed their mind / Price error / Duplicate sale / Test sale / Other | Besan 39 → **42** (+3) | `cash_out` **1,169.99**; expected 2,095.53 → **925.54** | status **cancelled**, `cancel_reason_code wrong_item`, reason text kept, `cancelled_at` set | **PASS** |

Every figure the sheet showed **before** the press was the figure that moved. Refunds are pro-rated
correctly: the discount and the tax both came back in the same share as the goods.

Three things about how the drawer *describes* an exchange (the money is right — `expected_cash` is exact at
every step; this is naming, and it is the same shape as **B21**, OPEN):

- cash handed back on an exchange is stored as the **replacement sale's `change_due`**, so the shift's
  **"Change given"** line reads **1,823.85** on a shift where no change was given. (`DrawerMath.php:73`:
  `change_given = Σ change_due`.)
- the exchange credit is a `SalePayment` with method **`other`**, so `tender_mix` grew an **`other`
  bucket of 4,767.46** (= 2,163.62 + 2,603.84) — credits for returned goods sitting in the list of
  tenders a cashier is asked to declare.
- `drawer.voids` stayed **0** after V1. That is correct by construction — `DrawerMath.php:129` counts
  sales **rung on this session**, and INV-000013 was rung on Kamran's. Worth knowing that the
  "ring-and-void" count the code reaches for is per-shift-of-ringing, not per-person-voiding.

### M9 — purchases and suppliers (as **Zoya Buyer**)

| # | What was done | Expected (worked out) | Screen | API | Verdict |
|---|---|---|---|---|---|
| PO1 | Alpha: **Tea 40 @ 1,100.00**, "Receive all" | order **44,000.00**; stock 0 → **40**; cost **1,100.00** | form total **Rs 44,000** | PO-000001 total 44,000.00 → `received`; Tea stock **40.000**, cost **1,100.00** | **PASS** |
| PO2 | Beta: **Tea 25 @ 1,247.50**, receive **only 15** (a short line) | order **31,187.50**; received value 15 × 1,247.50 = **18,712.50**; stock 40 → **55**; weighted average = (40 × 1,100 + 15 × 1,247.50) / 55 = 62,712.50 / 55 = 1,140.2272… → **1,140.23** | form total **Rs 31,187.50** | PO-000002 → `partially_received`; Tea stock **55.000**, cost **1,140.23** | **PASS** |
| PO3 | Alpha: **10 × "Carton of 12" @ 780.00 a box** | order **7,800.00**; stock in **120 pieces**; cost per piece 780 ÷ 12 = **65.00**; new average = (211 × 50 + 120 × 65) / 331 = 18,350 / 331 = 55.4380… → **55.44** | form total **Rs 7,800** | Cola stock 211 → **331**, cost **55.44**; line kept `unit=box` @780.00 | **PASS** — a box price is divided by the box, not charged per piece |
| PO4 | Beta: Yogurt 33 @ 107.75, then **Cancel PO** | order **3,555.75**; cancelled; **no** stock, **no** balance | form total **Rs 3,555.75**; the PO page said "Arrived — the bill **Rs 0** · Paid **Rs 0** · Left to pay **Rs 0** · Nothing has arrived yet, so nothing is owed"; the confirm asked "Nothing is received and the order stops being expected" | status **cancelled**; Yogurt stock **66.000** before and after; Beta balance **0** | **PASS** (B13's fix confirmed: due comes from what *arrived*, not what was ordered) |
| SP1 | Pay Alpha **20,000.00** by transfer **against PO-000001** | Alpha 51,800 → **31,800.00**; PO-000001 paid **20,000 of 44,000** | list "Rs 31,800" | balance **31,800**; PO-000001 `paid 20,000.00` | **PASS** |
| SP2 | Pay Beta **18,712.50** cash on the **whole account** | Beta → **0** ("Settled"); PO-000002's paid share = its **received** value 18,712.50 | list "**Settled**" | PO-000002 total 31,187.50 · received 18,712.50 · **paid 18,712.50** | **PASS** |
| SP3 | **(M14) DOUBLE-PRESS** "Record payment" — 1,111.11 cash to Alpha against PO-000003 | **one** payment; Alpha 31,800 → **30,688.89**; no error after the success | list "Rs 30,688.89" | **one** payment row 1,111.11; `paid_total` 21,111.11 | **PASS** |

**Supplier History** (Alpha): owes **Rs 30,688.89**; payments 20,000 + 1,111.11 = **21,111.11**; orders
PO-000001 bill 44,000 paid 20,000 **left 24,000**, PO-000003 bill 7,800 paid 1,111.11 **left 6,688.89**.
Σ left = **30,688.89** = the balance. **Law 5 holds to the paisa.**

### M10 — stock value and cost of goods

| # | What was done | Expected (worked out) | Read back | Verdict |
|---|---|---|---|---|
| C1 | **Sell Tea ×3 @1,475.00** after the two purchases above | goods **4,425.00**; tax **752.25**; total **5,177.25**; **cost of goods 3 × 1,140.23 = 3,420.69**; margin 4,425.00 − 3,420.69 = **1,004.31**; stock 55 → **52** | chips sub 4,425 · tax 752.25 · GT 5,177.25; change 22.75 on 5,200; the sale line's **`unit_cost` is stamped 1,140.23**; stock **52.000** | **PASS** (INV-000026) |
| — | Valuation | Tea 52 × 1,140.23 = **59,291.96**; Cola 331 × 55.44 = **18,350.64**; Besan 42 × 240.50 = **10,101.00** | exactly those three figures | **PASS** — **law 6 holds** |
| — | the item's own history | 0 **+40** → 40, **+15** → 55, **−3** → 52 | `in 40 → 40 (PO-000001)`, `in 15 → 55 (PO-000002)`, `out −3 → 52 (Sale INV-000026)` | **PASS** — it adds up |
| — | Margins' own cost | Tea revenue 4,425 · cogs **3,420.69** · profit **1,004.31** · 22.7 % | the same three figures | **PASS** |

### M11 — expenses and income

| # | What was done | Expected | Screen | API | Verdict |
|---|---|---|---|---|---|
| E1 | **Cash** expense **1,875.50** (Utilities) filed by **Accounts, who has no shift** | either refused, or the cash reaches a real drawer, or the person is **told** | *"**Worth knowing** — Recorded as cash, but you have no shift open — the drawer was not adjusted."* on the saved sheet | recorded, `cash_movement_id` absent, no drawer touched | **PASS** — it is said plainly, not silently |
| E2 | **Bank transfer** expense **9,340.75** (Rent) | no drawer movement at all | no drawer note (correctly) | no drawer movement | **PASS** |
| E3 | **Other income 2,450.25** cash (no shift) | counted as income, not a sale; the no-drawer note shown | the income form says "Cash goes into your open drawer…" and the note appeared | recorded; **not** in revenue | **PASS** |
| E4 | **Cash expense 625.54** filed by the **shift supervisor, drawer open** | her expected cash **925.54 − 625.54 = 300.00**; one `expense_out` movement | no note (nothing to warn about) | expected **300.00** exactly; movements: `expense_out out 625.54`, plus `void_refund out 1,169.99 · Cash returned · voided INV-000013` from V1 | **PASS** — **a drawer expense lowers expected cash** |

Σ expenses 1,875.50 + 9,340.75 + 640.40 + 625.54 = **12,482.19**; Σ income **2,450.25**. Both appear **once**
in the Cashbook, once in the Ledger and once in Reports (figures below).

### M12 — Reports and Dashboard, every figure worked out first

Hand figures from the raw records (25 counted sales, 1 cancelled, 3 returns, 4 expenses, 1 income):

| Hand | Figure |
|---|---|
| Σ sale totals (completed + partially refunded) | **98,978.25** |
| Σ subtotal − Σ bill discount + Σ tax | 85,291.75 − 425.00 + 14,111.50 = **98,978.25** ✓ identity holds |
| Σ tax charged | **14,111.50** |
| Σ refund_total / Σ refund_tax | **5,469.45** / **794.71** |
| Σ (qty × stamped unit_cost) on counted sales | **67,098.19** |
| cost of the returned goods (2 × 240.50 + 1,500 + 1,760) | **3,741.00** |
| Σ expenses / Σ other income | **12,482.19** / **2,450.25** |
| Σ rounding adjustments | **−3.15** |

| Where | Figure | Server | Hand | |
|---|---|---|---|---|
| **Cashbook** | sales / other / expenses / refunds | 98,978.25 / 2,450.25 / 12,482.19 / 5,469.45 | same | ✓ |
| | money out | 57,775.25 | 12,482.19 + 5,469.45 + supplier 39,823.61 = **57,775.25** | ✓ |
| | net | 43,653.25 | 101,428.50 − 57,775.25 | ✓ |
| **Tax report** | tax collected / refunded / payable | 14,111.50 / 794.71 / **13,316.79** | 14,111.50 − 794.71 = **13,316.79** | ✓ |
| | gross / net sales · taxable sales | 98,978.25 / 84,866.75 · **24** | 98,978.25 − 14,111.50; 25 sales less the one 0 %-tax bill | ✓ |
| **Reports → Summary** | revenue / refunds / other income / expenses | 98,978.25 / 5,469.45 / 2,450.25 / 12,482.19 | same | ✓ |
| | tax | 13,316.79 | the **payable** (net of refunded tax) — same as the Tax report | ✓ |
| | **cogs** | **63,357.19** | 67,098.19 − **3,741.00** (the returned goods' cost comes back) | ✓ exact |
| | gross profit | 16,834.82 | 98,978.25 − 5,469.45 − 13,316.79 − 63,357.19 = **16,834.82** | ✓ |
| | **net profit** | **6,802.88** | 16,834.82 + 2,450.25 − 12,482.19 = **6,802.88** | ✓ **law M12 holds** |
| | series (1 day) | revenue 98,978.25, profit 6,802.88 | = the totals | ✓ Σ daily series = totals |
| | **collections** | 5,000.00 · 2 · cash | the two khata payments, **listed apart from sales** | ✓ **law 9** |
| **Dashboard today** | revenue / other / refunds / expenses / **profit** | 98,978.25 / 2,450.25 / 5,469.45 / 12,482.19 / **6,802.88** | identical to Reports | ✓ **Dashboard today = Reports today** |
| **Staff report** | Kamran 23 → 94,688.27 · Saira 2 → 4,289.98 | Σ = **25 sales / 98,978.25** | ✓ |
| **Purchases report** | orders 3 · ordered 82,987.50 · paid 39,823.61 · outstanding 30,688.89 | 44,000 + 31,187.50 + 7,800; 20,000 + 18,712.50 + 1,111.11; = Alpha's balance. The **cancelled** PO is excluded | ✓ |
| **Bank claims** | card value 3,509.99 · **claim 351.00** · unreferenced 0 | INV-000012, last4 4417, QA Bank — this is where the bank's share lands | ✓ |
| **Offline report** | all zeros | nothing rung offline yet | ✓ |
| **Valuation** | per M10 | ✓ |

**Two reports disagree, and one figure is in no report** — both filed below as **$4** and **$5**.

### M6 — shift and drawer, counted out

Both shifts were driven to a close through the till.

| Figure | Kamran (float 7,350.00) | Hand | Saira (float 3,275.00) | Hand |
|---|---|---|---|---|
| cash sales | 75,454.91 | 76,143.99 tendered − 689.08 change − 0 refunds | **−1,179.47** | 1,346.37 − 1,823.85 − 701.99 |
| cash in | **7,500.00** | 5,000 khata + **2,500.00 pay-in** | 0.00 | — |
| cash out | **1,750.25** | the **pay-out** | **1,795.53** | 1,169.99 void refund + 625.54 cash expense |
| expected | **88,554.66** | 7,350 + 75,454.91 + 7,500 − 1,750.25 ✓ | **300.00** | 3,275 − 1,179.47 − 1,795.53 ✓ |
| counted (by note) | **88,555.00** | 17×5,000 + 3×1,000 + 500 + 50 + 5 | **295.00** | 2×100 + 50 + 2×20 + 5 |
| variance | **+0.34 "over"** | 88,555.00 − 88,554.66 | **−5.00 "short"** | 295 − 300 |

The close sheet printed exactly those three figures each time ("Counted Rs 88,555 · Expected Rs 88,554.66 ·
**Over Rs 0.34**"; "Counted Rs 295 · Expected Rs 300 · **Short Rs 5**"), and the stored session rows carry
them plus the denomination breakdown. **Law 3 holds to the paisa on both drawers.**

Card, transfer, wallet and khata never entered the drawer: Kamran's expected cash is built only from cash
tendered, change, pay-ins and pay-outs, while his tender mix separately shows card 7,668.98, wallet
1,487.50, transfer 1,009.99, credit 9,882.73. The drawer panel prints the whole derivation on screen:
`+ Cash tendered 76,143.99 − Change given 689.08 − Cash refunds 0.00 = Cash sales 75,454.91
+ Opening float 7,350.00 + Cash in 5,000.00 − Cash out 0.00 = Expected cash 87,804.91` (read before the
pay-in/pay-out). **B20** (OPEN) confirmed unchanged: the khata cash sits under "**Cash in (paid in, float)**".

Observations, not filed:
- `tender_mix.cash` read 74,974.00 against `cash_tendered` 76,143.99 — the gap is exactly the voided
  INV-000013's 1,169.99. Correct: a void is not a sale, but its cash really did pass through his drawer,
  and the money was handed back out of **Saira's**, which is where the cash physically went.
- with `pos_denomination_count` on there is **no total box** — only the ten note boxes — so a drawer whose
  expected cash carries paisa can never be counted level: 88,554.66 is not a sum of Pakistani notes, and
  the smallest honest count is 88,555 (+0.34). This is the reason `cash_rounding` exists, so it is not a
  defect; but the in-app help (`help/content.ts:874`) says "Type how many of each note you have **(or the
  total)**", and the total it offers is not on the screen.

### M7 — business day (two shifts, then closed)

Worked out by hand as Σ of the two shifts, then read off the Day screen and the frozen day row:

| Figure | Hand (Σ shifts) | Day screen | Frozen day row | |
|---|---|---|---|---|
| Rung up | 94,688.27 + 4,289.98 = **98,978.25** | RUNG UP **Rs 98,978.25** · 25 sales | sales_total **98978.25**, sales_count **25** | ✓ |
| shifts | 2 | "2 of 2 shifts counted" | shifts_count **2** | ✓ |
| float | 7,350 + 3,275 = **10,625.00** | — | **10625.00** | ✓ |
| cash takings | 75,454.91 + (−1,179.47) = **74,275.44** | CASH TAKINGS **Rs 74,275.44** "Excludes card and account" | **74275.44** | ✓ |
| cash in | **7,500.00** | — | **7500.00** | ✓ |
| cash out | 1,750.25 + 1,795.53 = **3,545.78** | — | **3545.78** | ✓ |
| in the drawers | 88,554.66 + 300.00 = **88,854.66** | IN THE DRAWERS **Rs 88,854.66** | **88854.66** | ✓ |
| counted | 88,555 + 295 = **88,850.00** | — | **88850.00** | ✓ |
| variance | 0.34 + (−5.00) = **−4.66** | COUNTED SO FAR **−Rs 4.66 short** | **-4.66** | ✓ |
| banked | **60,000.00** | BANKED **Rs 60,000** · STILL IN THE SHOP **Rs 14,275.44** (= 74,275.44 − 60,000) | banked_amount **60000.00** | ✓ |

**Law 2 holds**: the sales list total, the Day's "Rung up" and Reports revenue are all **98,978.25**.
**Law 9 on the Day screen**: khata shows as "**Collected on khata** Rs 5,000 · 2 payments" with the words
"Paid against earlier credit sales — **not sales, so not added to them**", listed apart from the takings.
The per-shift table printed Kamran 94,688.27 / 88,554.66 / 88,555 / **+Rs 0.34 over** and Saira
4,289.98 / 300 / 295 / **−Rs 5 short**.

A **deposit of Rs 60,000** behaved as its own sheet promised — "No drawer moves — that money left the till
hours ago": BANKED went to 60,000, STILL IN THE SHOP to 14,275.44, and IN THE DRAWERS stayed 88,854.66.
Closing the day froze every figure and the screen said "Fri, 16 Oct 2026 **has been closed off** · Main ·
closed at 10:59 PM by Nadia Owner · **Rs 98,978.25 in sales**", offering "Open today again".

Observation (not filed): the day row has a **`tender_mix` column that is never filled** (`null` on the
closed day), and the Day screen shows no tender breakdown of the day's sales — only of the khata
collections. So "the day's total **by method**" is reachable per shift (each Z-read has it) but is never
summed for the day.

### M13 — loyalty (1 point per Rs 100 of goods, 1 point = Rs 1, minimum 100 to redeem)

| # | What was done | Expected (worked out) | Screen | API | Customer card | Verdict |
|---|---|---|---|---|---|---|
| L1 | **Earn** — Rice ×1 (2,999.99) + Besan ×5 (1,666.65) on Nasreen's account | goods **4,666.64**; tax 17 % = 793.3288 → **793.33**; total **5,459.97**; points **floor(4,666.64 / 100) = 46**; her 56 + 46 = **102** | sub 4,666.64 · tax 793.33 · GT 5,459.97 | `points_earned` **46** | **102** | **PASS** (INV-000027) |
| L2 | **Redeem 100** points on Ghee ×1 @1,849.25 | −**Rs 100** off the goods; taxable **1,749.25**; tax 297.3725 → **297.37**; total **2,046.62**; she then earns on what she **actually paid**: floor((1,849.25 − 100)/100) = **17**; 102 − 100 + 17 = **19** | the box offered "**Max 102**"; chips sub 1,849.25 · disc −100 · taxable 1,749.25 · tax 297.37 · GT 2,046.62 | `discount 100.00`, `points_redeemed` **100**, `points_earned` **17** | **19** | **PASS** (INV-000028) — the redeemed value comes off **once**, and the tax is charged on the reduced figure |
| L3 | **Return** the Rice line of INV-000027 (the sale that earned 46) | refund 2,999.99 × 1.17 = 3,509.9883 → **3,509.99** (goods 2,999.99 + tax **510.00**); the line's 29 points come back off, but she holds only 19 | "Goes back to the customer **Rs 3,509.99** incl. **Rs 510** tax" | RET-000004 total **3,509.99** tax **510.00**, one line Rice ×1 | **0** | money **PASS**; points clamped — see the note |

Points on L3: the returned line had earned **floor(2,999.99/100) = 29**, she held **19**, and the balance
went to **0** rather than −10. The clamp is the only sane answer, but it means a balance cannot be
rebuilt from the history after a return, and Rs 29 of points she had already spent (L2's Rs 100 off) came
from goods she gave back. Recorded as P3, not filed — no stored figure is wrong, and it is the same family
as **B10** (OPEN).

### M14 — every final money button pressed twice

| Button | Where | Result |
|---|---|---|
| **Complete sale** (Pay) | till, Besan ×2 = 779.99, cash 800 | **one** sale INV-000029; exactly **one** sale of 779.99 paid with 800.00 exists; sheet "Change Rs 20.01"; no error after the success — **PASS** |
| **Refund & restock** | INV-000027, Rice ×1 | **one** return RET-000004 (`returns.length === 1`); refund 3,509.99 once — **PASS** |
| **Record payment** (supplier) | Alpha, 1,111.11 | **one** payment; balance moved once (M9 · SP3) — **PASS** |
| **Close shift** | both shifts | the sheet closes on the first press and the button goes with it; one closed row each — **PASS** |
| **Close off day** / **Record deposit** / **Receive** | day close, 60,000 deposit, PO receives | one record each; the day's figures froze once — **PASS** |

In every case the second press found the button gone (the sheet had already closed), which is the
mechanism rather than an accident — the server also carries `once` on these routes.

### M15 — who sees money (read through the API, not just the screen)

| Path | Cashier | Stock keeper | Owner |
|---|---|---|---|
| `/dashboard` | 200 · `sees {profit:false, expenses:false, takings:true}`; **profit `null`**, expenses `null`, other_income `null`; revenue 98,978.25 and refunds shown (they are takings) | 200 · `sees` **all false**; revenue, profit, expenses, refunds, sales_count **all `null`** | profit 6,802.88, expenses 12,482.19 |
| `/products` | `cost` **absent**, `wholesale_price` null | `cost` **240.50** — see below | cost 240.50 |
| `/sales/{id}` | 200, line `unit_cost` **absent** | **403** | `unit_cost` 1,140.23 |
| `/reports/summary`, `/margins`, `/valuation`, `/tax`, `/staff`, `/purchases`, `/cashbook`, `/ledger` | **403** on all eight | **403** on all eight | 200 |

**PASS.** Nothing is merely hidden on screen — the figures are `null` or the key is gone, and `null` is
used rather than `0`, so no tile can be drawn from an absence.

One thing for the owner to confirm rather than a bug: the **stock keeper does see `cost` on a product**.
That is deliberate — `Permissions.php:265` defines `READS_COST = products.manage, purchases.manage,
inventory.manage, reports.view`, and `HidesCostPrice` says in as many words that whoever receives a
delivery types what it cost. The brief's M15 asks for "no cost … for cashier **and stock keeper**", so if
that is the intention the permission list is where it changes.

### M8 — quotations, advances, installments

| # | What was done | Expected (worked out) | Screen | API | Verdict |
|---|---|---|---|---|---|
| Q1 | **Quotation** — Ghee ×2 (3,698.50) + Tea ×1 (1,475.00) | goods **5,173.50**; tax 17 % = 879.495 → **879.50**; total **6,053.00** | the sheet header said "Rs 5,173.50 · 2 lines"; the list showed QUO-000001 | QUO-000001 total **6,053.00** | **PASS** |
| A1 | **Hold on advance** — Rice ×2, advance **Rs 2,500** cash | goods 5,999.98; tax **1,020.00**; total **7,019.98**; left **4,519.98**; the drawer rises 2,500; revenue must not move | LAY-000001 · total Rs 7,019.98 · paid Rs 2,500 · **36 %** · left Rs 4,519.98; tiles **ADVANCES HELD Rs 2,500** "Customers' money in your till — **not yet earned**", **STILL TO COLLECT Rs 4,519.98** | summary `deposits_held 2500`, `layaway_value 7019.98`, `balance_outstanding 4519.98`; drawer `cash_in` 0 → **2,500**, expected 12,386.58 → **14,886.58**; movement `deposit_in 2500.00 · Advance · LAY-000001`; **`sales_total` unchanged** | **PASS** |
| A2 | instalment **Rs 2,000** cash | paid **4,500.00**, left **2,519.98** | the sheet said "Rs 4,519.98 still owed. You can't take more than that." | paid 4,500.00; drawer cash_in **4,500**, expected **16,886.58**; revenue still unmoved | **PASS** |
| A3 | the last instalment **Rs 2,519.98** | paid **7,019.98**, left **0.00**, "Paid up" | counted as paid up (1 paid-up booking) | cash_in **7,019.98**, expected **19,406.56**; revenue **still** unmoved | **PASS** |
| A4 | **Bill & hand over** | **one** sale of 7,019.98 now; the drawer must **not** rise again | "This booking is **paid in full — nothing to collect**", Bill it enabled; after: "**Billed as INV-000030** · The goods have been handed over and the sale is on the books"; PAYMENTS RECEIVED lists 2,500 + 2,000 + 2,519.98 | **exactly one** sale INV-000030 total 7,019.98, method `deposit`; drawer expected **unchanged at 19,406.56**; `sales_total` +7,019.98, count 3 → 4; document → `converted`; summary `deposits_held` → **0** | **PASS** — each paisa paid in appears once, and the sale is counted once, at hand-over |
| I1 | **Sell on installments** — Ghee ×2, charge **10 %**, advance **500**, **3 months** | the charge must go to Other income; the financed part to the khata; nothing double-counted | the sheet said **Bill Rs 4,068.50** and "**2 × Rs 1,190** + Rs 1,188.50" | the plan is cash_price **4,327.25** (tax-inclusive), markup **433.00** (10 % of 4,327.25 = 432.725), total **4,760.25**, advance 500, financed **4,260.25**, monthly **1,421.00 × 2 + 1,418.25**; sale INV-000031 at the **cash price** 4,327.25; income row "**Installment charge · INS-000001 Rs 433.00**"; her khata **4,260.25** (= 3,827.25 financed goods + 433.00 charge, shown as two statement lines) | money **PASS**, the quoted figures **FAIL → $8** |
| I2 | **one month, Rs 1,421.00 cash**, taken from her customer card | khata 4,260.25 − 1,421.00 = **2,839.25**; drawer +1,421.00; revenue must **not** move | it asked: "QA Qist Shahida is paying for goods on installments. Is this **Rs 1,421** an installment? [Yes — on INS-000001] [No — on the khata] · INS-000001: up to date · Rs 4,260.25 left"; after: **Owes Rs 2,839.25**; statement "Installment · Cash · INS-000001 −Rs 1,421" | plan paid **1,421.00**, month 1 `paid`, next due 16 Dec; **revenue unchanged** at 118,612.06; **collections 5,000 → 6,421.00**; drawer cash_in 7,019.98 → **8,440.98**, expected → **21,327.56** | **PASS** |
| — | the deposit floor | 20 % of **7,019.98** = **1,404.00** | the sheet says "At least 20 % down — **Rs 1,200**" and **enables** the button | server refuses: `422 DEPOSIT_BELOW_MINIMUM` "at least 20 % down — **Rs 1,404.00**" | **FAIL → $7** |

**B65** (OPEN) confirmed unchanged: a saved quotation offers no way to hold its goods on advance — the
layaway had to be built from scratch. On a layaway **paid in full**, neither symptom of **B25**/**B26**
appeared (the document read "Balance due Rs 0" correctly, all three payments were listed, and "Bill it"
was enabled without typing); the *part-paid* hand-over those two describe was not reached.

### M10/M18 — a transfer, and the two branches

| # | What was done | Expected (worked out) | Read back | Verdict |
|---|---|---|---|---|
| T1 | **Transfer** 10 Besan (@240.50) + 5 Tea (@1,140.23) Main → Township, sent and received | value moved 2,405.00 + 5,701.15 = **8,106.15**; the shop's valuation must **not change** | whole shop **446,102.60 before and after** (Besan 35, Tea 52 unchanged); as the manager (who sits at **Main**) it read 437,996.45, and 437,996.45 + 8,106.15 = **446,102.60**; `by-place` Besan **Main 25 + Township 10 = total 35** | **PASS** — a transfer moves value and never changes it |
| B1 | **Besan ×3 at Township**, cash 1,200 | goods 999.99, tax **170.00**, total **1,169.99**, change **30.01**; Township 10 → 7, Main still 25 | chips and the sheet exact; `branch` on the sale = **Township**; `by-place` Besan **Main 25 + Township 7 = 32**; her drawer float 950 + 1,169.99 = **2,119.99** | **PASS** |
| — | **do the branches add up?** | Main + Township = the whole shop | **Dashboard by branch: Main 30 sales / 118,612.06 + Township 1 / 1,169.99 = 31 / 119,782.05**, which is exactly the whole-shop `today` figure; Reports summary 119,782.05 / 31 — identical | **PASS — law 8 holds** |

Observation (not filed): `/reports/valuation` **ignores a `branch_id` query parameter** — all three scopes
returned the identical whole-shop figure; the report is scoped by the reader's own branch context instead.
And `/pos/day`'s `also_trading` array came back as a single **empty object** `[{}]` while Township was
trading, so the Day screen at Main has nothing to print for the other branch.

### Law 10 — every figure after a reload, and in its CSV

Each export was pulled and totalled against the live API in the same breath:

| Export | Rows | CSV total | API total | |
|---|---|---|---|---|
| `/sales/export` | 32 | Σ total **120,952.04** (incl. the one cancelled sale) · **119,782.05** excluding it | identical, both ways | ✓ |
| `/ledger/export` | 44 | Σ In **122,665.30** · Σ Out **61,285.24** | `totals {in 122665.3, out 61285.24, net 61380.06}` | ✓ |
| `/reports/valuation/export` | 10 | Σ cost_value **445,381.10** | **445,381.10** (= 446,102.60 − 3 × 240.50 sold at Township) | ✓ |
| `/reports/margins/export` | 10 | revenue **95,498.04** · cost **74,862.19** · profit **20,635.85** | identical | ✓ |
| `/expenses/export` | 4 | Σ **12,482.19** | **12,482.19** | ✓ |
| `/incomes/export` | 2 | Σ **2,883.25** | **2,883.25** | ✓ |
| `/customers/export` | 5 | balances as the cards | ✓ | ✓ |
| `/reports/bank-claims/export` | 1 | sale 3,509.99 · claimed **351** | **351** | ✓ |

Every figure in this report was read after a fresh page load (each walk navigates afresh), and the
screen, the API and the CSV agreed each time. **Law 10 holds.**

### `php artisan loadtest:audit`

**423 of 425 checks agree.** The two that disagree are the same fixture-shape check printed twice —
"*some rows have two axes, not one — **0 of 0** are colour and size*". It is a complaint that the
load-test fixtures contain no two-axis variant rows to check, not a money figure that came out wrong.
Everything money-shaped passed, including: "the tax on a bill is the tax on its own lines (543 taxed
bills)", "every drawer's expectation is its own arithmetic (7 shifts)", "every variance is counted minus
expected", "every closed day is the sum of its own shifts (7 days)", "nothing went to the bank that was
never in the drawer", "an exchange credit never left the drawer (15 credits)", "every exchange credit
paid for something (28,119.64 both ways)", "a voided sale is on nobody's khata", "no line refunded more
than it was paid for", and "the branch shelves sum to the product's own figure (258 items)".

## 4. Each bug

### $1 · P1 · Till · A **percent** line discount is silently charged as **rupees**

**Who and which screen** — any cashier with `discounts.apply`, on the till's line sheet (tap a cart row).

**Steps (either one)**
1. Ring QA Rice Bag ×1 (2,999.99). Tap the line. Set **Discount Type → Percent %**, then type **7.5** in
   Discount. Press Done.
2. Or: type **7.5**, set Percent % (this works), press Done — then reopen the line, **clear the Discount
   box** and type **10**.

**Expected (worked out)** — (1) 2,999.99 × 7.5 % = 224.99925 → **−225.00**, taxable 2,774.99, tax **471.75**,
total **3,246.74**. (2) 2,999.99 × 10 % = **−300.00**.

**Actual, in each place**
- path 1: cart row "−**Rs 7.50**" (no "%" anywhere) · chips Discount −7.50, Taxable 2,992.49, Tax **508.72**,
  Grand Total **3,501.21** · tender due 3,501.21 · API `line_discount 7.50`, subtotal 2,992.49, total 3,501.21.
  **The customer is overcharged Rs 254.47** (217.50 goods + 36.97 tax). Sold as **INV-000007**.
- path 2: the select read `pct` on reopen, flipped to **`amt`** the instant the box was emptied, and stayed
  `amt` when 10 was typed → "−Rs 10", total 3,498.29 instead of 3,246.74 — **Rs 251.70 overcharged**.

**Proof** — probe run: `A. mode BEFORE: amt` → `selectOption('pct')` → `B. mode after: amt` (it snapped
back) → typing 7.5 → `−Rs 7.50`. And: `2. mode on reopen: pct` → `3. mode after clearing the box: amt`.

**Cause** — `panel/src/modules/pos/pages/PosPage.tsx:2046`

```js
const setLineDiscount = (key, value, mode) =>
  setCart((c) => c.map((l) => (l.key === key
    ? { ...l, discountValue: value > 0 ? value : undefined, discountMode: value > 0 ? mode : undefined }
    : l)));
```

The Discount Type select's `onChange` calls `setLineDiscount(l.key, l.discountValue ?? 0, newMode)`. With
no amount typed yet the value is 0, so `value > 0` is false and **the mode is thrown away** — the select
reverts to "Fixed amount" and the next keystroke is read as rupees.

**Fix direction (not done)** — keep `discountMode` whenever a mode is explicitly chosen, independently of
whether an amount has been typed; only `discountValue` should be cleared by a zero. A test that sets the
type first and then the amount would have caught it.

### $2 · P3 · Till · A 7.5 % line discount is printed as "**8 %**"

The cart row shows `−Rs 225` with `8%` under it. The money is right; the label is rounded to a whole
number. **Cause** — `panel/src/modules/pos/pages/PosPage.tsx:3550`:
`const discPct = disc > 0 && gross > 0 ? Math.round((disc / gross) * 100) : 0;` (also used at :3593).
**Fix direction** — keep one decimal, or print the percentage the cashier actually typed rather than
re-deriving it from the money.

### $3 · P1 · Receipt · A **rounded-down** sale prints "**Balance due**" when nothing is owed

**Who** — any shop with `cash_rounding` set to 1, 5 or 10; the customer's printed receipt.

**Steps** — Settings → cash rounding **10**. Ring QA Loose Chana Daal 0.375 kg (bill **544.05**). The till
rounds to **540.00** and takes 540.00 cash. Print the receipt.

**Expected** — the sale is settled: nothing owed.

**Actual** — the receipt prints, correctly, `Total Rs 544.05 · Rounding − Rs 4.05 · To pay Rs 540.00 ·
Cash Rs 540.00` and then adds **`Balance due Rs 4.05`**. With rounding 1 it prints `Balance due Rs 0.05`
(INV-000017). Every screen is right — the sales list says **Completed**, the sale sheet says "Total
Rs 544.05 · Paid Rs 540" and no screen claims a balance. Only the document the customer keeps does.

**Proof** — INV-000019 (rounding 10) and INV-000017 (rounding 1); `rounding_adjustment −4.05` / `−0.05`.

**Cause** — `backend/resources/views/invoices/show.blade.php:600`

```php
@php($due = round((float) $sale->total - (float) $sale->amount_paid - $bankOff, 2))
@if($due > 0) <tr class="tender change"><td>Balance due</td>…
```

It subtracts the bank offer's share (the B08 fix) but **not `rounding_adjustment`** — which the same
template already reads at line 551 to print the "Rounding / To pay" block just above.

**Fix direction** — include the rounding in `$due`, e.g.
`$sale->total + $sale->rounding_adjustment - $sale->amount_paid - $bankOff`. Worth a test per step (1, 5,
10) for both a round-down and a round-up.

### $4 · P2 · Ledger · The running balance is carried down rows that are **not in time order**

**Who** — owner/accounts, Ledger screen (`/tenant/ledger`), whose own heading says "Every movement of
money, **in the order it happened**, with the balance carried down."

**Steps** — on a day with both sales and a supplier payment, open the Ledger.

**Expected** — rows in the order they happened; each balance the account's real standing at that moment.

**Actual** — all three supplier payments come first, so the balance reads **−20,000 → −38,712.50 →
−39,823.61** *before* the day's first sale, then climbs back. The sales were rung from 17:20 and the
supplier payments recorded at 17:39–17:40. The **closing balance is right** (61,380.06, and the CSV
agrees); every intermediate balance is fiction.

**Proof** — `GET /ledger` row 1 `supplier_payment … balance −20000`, row 4 `sale INV-000001 … balance
−38653.62`. The supplier payment rows carry `paid_at` **`2026-10-16T00:00:00`** while their `created_at`
is `17:39:39`.

**Cause** — `backend/app/Services/LedgerService.php:415` selects
`supplier_payments.paid_at as sort_at`, and the union is ordered by `entry_date, sort_at, id`
(`:82-84`). `paid_at` is the **date** the user picks on the pay sheet ("Paid on"), stored at midnight, so
every supplier payment sorts to the start of its day — ahead of sales (`sales.sold_at`) and expenses
(`expenses.created_at`), which are real moments.

**Fix direction** — order within a day by the moment the row was written when the chosen date carries no
time, e.g. `COALESCE(NULLIF(TIME(paid_at),'00:00:00') … )` or simply add `created_at` as the tie-break
after `sort_at`. A test with a sale at 10:00 and a supplier payment recorded at 18:00 on the same date
should fail without the fix.

### $5 · P2 · Reports · **Margins** never apportions a bill discount, so gross profit disagrees with Summary

**Steps** — give a bill discount (Rs 200 on INV-000008, Rs 150 coupon on INV-000009, Rs 75 promotion on
INV-000010 — Rs 425 in all), then compare Reports → Summary with Reports → Margins for the same day.

**Expected** — one gross profit for the shop.

**Actual** (daily, at the time of reading) — Summary `gross_profit` **16,834.82**
(= revenue 98,978.25 − refunds 5,469.45 − tax 13,316.79 − cogs 63,357.19); Margins `profit`
**17,259.82**. The difference is **exactly Rs 425.00** — the bill discounts. Margins' own revenue
(80,617.01) is Σ subtotal (85,291.75) − returned line values (4,674.74), with the Rs 425 never taken off,
while Summary's net goods figure is 80,192.01.

**Cause** — `backend/app/Services/ReportService.php:414`:
`$line = 'sale_items.line_total - COALESCE(returned.total, 0)'` — the per-product revenue is the gross
line value net of returns only. Line discounts are inside `line_total`, so they are handled; a
**sale-level** `discount` (manual, coupon or promotion) is apportioned to no line.

**Fix direction** — pro-rate `sales.discount` across the sale's lines by value (the same share the refund
engine already uses — it got R1's 200/3 exactly right), or state on the Margins screen that it is before
bill-level discounts. Either way the two reports must not print two different gross profits.

### $6 · P2 · Drawer · A **refund may overdraw the drawer** with no warning, while a pay-out from the same drawer is refused

**Steps** — open a shift with a float of **2,000**. Refund **3,509.99** (the Rice line of INV-000027).
Then try a **pay-out of 500** from the same drawer.

**Expected** — either the refund is refused or flagged as more than the drawer holds, or the two paths
agree.

**Actual**
- the refund goes through with no warning (`refund-no-drawer` showed nothing), and the till then prints
  **"EXPECTED IN DRAWER Rs −1,509.99"** with the derivation
  `+ Cash tendered 0.00 − Change given 0.00 − Cash refunds 3,509.99 = Cash sales −3,509.99 + Opening
  float 2,000.00 … = Expected cash −1,509.99`;
- the pay-out of 500 is **refused**: `422 INSUFFICIENT_DRAWER_CASH` — *"That is more than the drawer
  holds (−1,509.99). Take out less than the drawer holds, or add a float first."*

So the shop is told it may not take Rs 500 out of a drawer the same screen says is already Rs 1,509.99
overdrawn, by a refund it was never warned about. The figure is also one a cash drawer cannot hold.

**Cause** — `backend/app/Actions/Pos/RecordCashMovementAction.php`: the drawer ceiling is enforced only
for cashier-entered movements (`$enforceDrawerLimit`, `:69-78`), and `record()` (`:128`) deliberately
passes `enforceDrawerLimit: false` for system movements — with the stated reason that a system movement
"records money that ALREADY moved". That is right for a void, but a **refund being authorised now** is a
decision, not a record of one.

**Fix direction** — warn on the refund sheet when the cash to hand back is more than the drawer holds
(the sheet already has `refund-no-drawer` for "no drawer at all"), and offer the float/safe route. If a
short drawer must still be able to refund, say so on the sheet rather than printing a negative expectation.

### $7 · P2 · Quotes & advances · The **minimum deposit** on screen is worked out before tax; the server enforces it after

**Steps** — shop setting `layaway_min_deposit_percent` = **20**. Hold goods on advance: Rice ×2 (goods
5,999.98, tax 1,020.00, **total 7,019.98**). Type an advance of **1,200**.

**Expected** — one minimum. 20 % of 7,019.98 = **1,404.00**.

**Actual** — the sheet says "**At least 20 % down — Rs 1,200**" and **enables** "Hold the goods" at 1,200.
Pressing it is refused: `422 DEPOSIT_BELOW_MINIMUM` — *"This shop asks for at least 20 % down —
**Rs 1,404.00**."* At 1,199 the button is disabled, so the only amount the screen allows is one the server
rejects. The cashier has the customer's Rs 1,200 in hand and a figure they were never shown.

**Cause** — `panel/src/modules/documents/components/NewDocumentSheet.tsx:53` computes
`about = Σ price × quantity` ("at shelf prices", **before tax**) and passes it as `total` at `:150`;
`panel/src/modules/documents/components/ParkAsDocumentModal.tsx:69` then does
`minimum = Math.ceil((total * minPct) / 100)`. The server uses the document's **tax-inclusive** total —
`backend/app/Actions/SaleDocument/CreateSaleDocumentAction.php:169`.

**Fix direction** — price the sheet from the server (the till already asks `/sales/worth` for exactly this
reason) or apply the tax rate before stating the floor. Same root cause as **$8**.

### $8 · P1 · Installments · The sheet quotes a **pre-tax** bill and monthly instalment; the plan is written tax-inclusive

**Who** — a cashier selling on installments (Quotations & advances → Sell on installments).

**Steps** — Ghee ×2 (shelf 1,849.25 each), installment charge **10 %**, advance **500**, **3 months**.

**Expected** — the figure read out to the customer is the figure the plan is written at.

**Actual, side by side**

| | the sheet said, before the press | the plan the server wrote |
|---|---|---|
| cash price | Rs **3,698.50** ("Cash price (shelf)") | Rs **4,327.25** (tax-inclusive) |
| installment charge 10 % | Rs **370** | Rs **433.00** |
| bill | Rs **4,068.50** | Rs **4,760.25** |
| the schedule | "Rs 500 now + **2 × Rs 1,190** + Rs 1,188.50 = Rs 4,068.50" | monthly **Rs 1,421.00 × 2 + Rs 1,418.25**, financed **4,260.25** |

A difference of **Rs 691.75** on the bill and **Rs 231.00 a month**, and **nothing on screen said the
figure had changed** — unlike the till, which shows "The bill is X · this till made it Y"
(`tender-corrected`). INS-000001, INV-000031.

**Everything the server then did was right**: markup 10 % of 4,327.25 = 432.725 → **433.00**; total
4,760.25; financed 4,760.25 − 500 = **4,260.25** on her khata as two honest statement lines ("On
installments +Rs 3,827.25" and "Installment charge +Rs 433"); the charge booked to **Other income**
(Rs 433.00, with the note "10 % on a cash price of 4,327.25 — charged on the customer's khata and
collected with the installments"); the sale recorded at the cash price 4,327.25; the advance of 500 in
the drawer; and an instalment of 1,421.00 taking her to 2,839.25 without touching revenue.

**Cause** — the same `about` as **$7**: `panel/src/modules/documents/components/NewDocumentSheet.tsx:53`
(`Σ price × quantity`, pre-tax) feeds `StartInstallmentModal`, which builds the whole quote from it —
`charge = Math.round((about * pct) / 100)` and `bill = about + charge`
(`panel/src/modules/documents/components/StartInstallmentModal.tsx:64-65`).

**Fix direction** — ask the server for the document's worth before the modal states a bill, a charge or a
schedule (there is already `POST /sale-documents` doing the arithmetic, and `/sales/worth` for the till),
and show a correction notice if the server's figure differs. Fixing `about` once fixes **$7** and **$8**
together.

## 5. Not tested, and why

| Row | Why |
|---|---|
| Tax-inclusive **returns** | Not reached — the one piece of M5 that an inclusive shop would exercise differently. A **tip** was tested (M16 · R3/R4) and is right. |
| Blind close, declared tenders, a second business day, stocktake, disposals, a budget ceiling, a recurring expense posting | Not reached. `pos_blind_close` and `pos_declare_tenders` were left **off**, so both close paths were counted openly. |
| Two shifts on **one lane** (a cover), and force-closing someone else's drawer | Not reached. |
| HR | Out of this version, per the brief. |

## 6. Where to pick this up

Everything below is in place and can be used as-is — nothing needs rebuilding.

- **Paisa QA Mart** — day **open** (closed off once at 10:59 PM and reopened at 11:03 PM, both on the
  activity trail). Kamran's and Saira's first shifts are **closed and counted**; a later shift of
  Kamran's (float 4,100) and one of Saira's (float 2,000, **expected −1,509.99** — see $6) and the
  Township cashier's (float 950) are **still open**. 32 sales, INV-000001…INV-000032. `cash_rounding` is
  back to **0**; Saira was granted `expenses.manage` during M11 and still has it.
- **Paisa QA Kitchen** — M16 and the inclusive half of M2 are **done**. Trading day 2026-10-16 still
  **open**, one shift open (float 2,200) at **expected cash 8,563.72** with `tips 218.28` inside it and
  `tender_mix {cash 6,364.72, card 1,500}`. Five sales INV-000001…5 (7,275.53 + 369.91 + 1,898.99).
  T1's probe tab was cancelled; **TAB-00002 on T2 is closed and fully paid**; one takeaway tab settled.
  The shop now carries a **delivery fee of 149.99** and one rider, **Imran Rider / RDR-000014**, whose
  ORD-000001 was delivered and settled (statement back to 0). Nothing here needs undoing — but note the
  fee setting and the rider are new since the earlier sections.
- **Walk scripts** — `panel/e2e/qa-kit/.money-*.mjs` (dot-prefixed, uncommitted). `.money-lib.mjs` holds
  the shared helpers (`openShift`, `add`, `totals`, `tender`, `pickMethod`, `complete`, `newSale`,
  `saleFromApi`). Run them with `cd panel && node e2e/qa-kit/.money-<name>.mjs`.
- **Every row of section 4 is walked.** What is left is the shorter list in §5 — things inside a row that
  were not reached (tax-inclusive **returns**, blind close, declared tenders, a second business day,
  stocktake, disposals, a budget ceiling, a recurring expense posting, a lane cover, force-closing
  another's drawer). None of them is a whole area.
- **Two things this pass changed on the Kitchen and left in place**, deliberately, because they are the
  evidence: `QA Fresh Lime`'s price is now **299.50** (it was 249.50 — changed mid-outage for M17 · O2,
  and INV-000006 is correctly still at 249.50), and the shop carries a **delivery fee of 149.99** and the
  rider **Imran Rider / RDR-000014**.
- **The Kitchen's till roster has several nameless web tills** (`ZHUU`, `FY8P`, `DRLL`, `MJ83`…) — one per
  Playwright context this pass opened, not ten real tills. Only `MJ83` ever rang anything.
- **Selectors worth keeping** (they cost time to find): a floor table tile is a plain button whose name
  is its contents — `getByRole("button", {name: /^T1\b/})`; a menu tile is
  `button:has(span:text-is("<dish name>"))` (**not** `^name`, because a count badge is prepended to the
  button's text the moment one is on the tab); the settle sheet's per-line steppers are
  `Settle less <dish>` / `Settle more <dish>`; Settings' `Field` renders a `<label>` with no `htmlFor`,
  so a field is reached by
  `xpath=//label[starts-with(normalize-space(.),"Delivery fee")]/following-sibling::div//input`; the
  Business tab's save button is **Save profile**; the rider hand-in is confirmed with **Cash received**.
- **Two measurement traps met here**, both mine: `/reports/*` ignores `from`/`to` unless
  `period=custom` is sent with them (it silently answers for the **month**), and the Cashbook is at
  `/cashbook`, not `/reports/cashbook`.


---

*Continued 2026-10-16, later. M16 and the tax-inclusive half of M2, on **Paisa QA Kitchen** — tax
**17 % inclusive**, tips **on**, shift required, `cash_rounding` **0**, day open, one shift open with a
float of **2,200.00**, **nothing rung** before this point (`sales_count 0`, `sales_total 0.00`).*

### M16 / M2 — the figures worked out BEFORE the tab was opened

The order put on **T1** (4 covers), prices deliberately awkward and every one of them **tax-inclusive**:

| Line | Qty × price | Gross (what the guest pays) | Tax = gross × 17/117 | Net |
|---|---|---|---|---|
| QA Chicken Karahi | 1 × 1,799.00 | 1,799.00 | 1,799.00 × 17/117 = 261.393162… → **261.39** | 1,537.61 |
| QA Mutton Biryani | 2 × 949.99 | 1,899.98 | 1,899.98 × 17/117 = 276.065470… → **276.07** | 1,623.91 |
| QA Naan | 7 × 33.33 | 233.31 | 233.31 × 17/117 = 33.899743… → **33.90** | 199.41 |
| QA Fresh Lime | 3 × 249.50 | 748.50 | 748.50 × 17/117 = 108.756410… → **108.76** | 639.74 |
| | | **4,680.79** | **680.12** | **4,000.67** |

Net 4,000.67 + tax 680.12 = **4,680.79** — the inclusive bill is unchanged by the tax, which is the whole
point of inclusive pricing, and the first thing to check.

**One paisa to watch.** Taxing the bill as a whole gives 4,680.79 × 17/117 = 680.1148… → **680.11**, one
paisa *under* the sum of the four lines (**680.12**). Both are defensible; what is not defensible is a
screen that shows subtotal + tax ≠ total, or a bill whose parts do not add back to the whole. Expected:
per-line tax, because that is what the Tax report has to agree with line by line.

**The split, by items** — party A takes the Karahi and 2 of the 7 naan, party B the rest:

| Part | Lines | Gross | Tax | Net |
|---|---|---|---|---|
| P1 (cash + tip) | Karahi ×1 + Naan ×2 (66.66) | **1,865.66** | 261.39 + 9.69 = **271.08** | **1,594.58** |
| P2 (card + cash) | Biryani ×2 + Naan ×5 (166.65) + Lime ×3 | **2,815.13** | 276.07 + 24.21 + 108.76 = **409.04** | **2,406.09** |
| | | **4,680.79** ✓ | **680.12** ✓ | **4,000.67** ✓ |

Σ parts = the whole tab to the paisa, in all three columns. Naan 2 of 7 → 66.66, tax 66.66 × 17/117 =
9.6856… → **9.69**; naan 5 of 7 → 166.65, tax 24.2141… → **24.21**; 9.69 + 24.21 = 33.90 = the whole
line's tax ✓ (a split that rounds each part separately *could* have lost a paisa here — it does not).

**The tip.** P1 pays with the 10 % button, whose own rule is `Math.round(total × 10)/100`
(`TabPage.tsx:1330`) = round(18,656.6)/100 = **186.57** (not 186.566 — the button deliberately lands on
the paisa). So **to collect on P1 = 1,865.66 + 186.57 = 2,052.23**, and the tip must *not* be revenue,
*not* tax, and must still be in the drawer.

**The tender split, by amount** — P2 pays **card 1,500.00** and the rest in cash: 2,815.13 − 1,500.00 =
**1,315.13**.

**The drawer** must therefore move by: cash P1 1,865.66 + cash P2 1,315.13 = **3,180.79** of cash sales,
plus the tip if a cash tip belongs in the drawer (it was handed over in cash) — so expected cash is
**2,200.00 + 3,180.79 = 5,380.79** without the tip, **5,567.36** with it. Card 1,500.00 must **never** be
in the drawer. Which of the two is right is a decision, not arithmetic; what is tested is that the tip
lands in exactly **one** place and is not counted as a sale.

### M2 — the same dish, the same shop, two screens (this is where it breaks)

| # | What was done | Expected (worked out) | What each place said | Verdict |
|---|---|---|---|---|
| X1 | **Counter** (`/tenant/pos`): QA Chicken Karahi ×1, cash 1,800 | the shop is **inclusive**, so the menu price **is** the bill: sub **1,799.00**, tax held within = 1,799 × 17/117 = **261.39**, total **1,799.00**, change **1.00** | chips Sub Total 1,799 · Tax **261.39** · Grand Total **1,799**; sheet "Total Rs 1,799 · Paid Rs 1,800 · Change Rs 1"; API INV-000001 `subtotal 1799.00` `tax 261.39` `total 1799.00` `tax_inclusive true` | **PASS** — inclusive tax is exactly right at the till |
| X2 | **The same dish on a dine-in tab** (T1, TAB-00001) | the same 1,799.00 — a tab is not a different shop | the tab's footer reads "Running total **+ tax at the bill**"; the settle sheet for a tab holding 4,331.30 of food showed **Tax Rs 736.32** and **Bill Rs 5,067.62**; `POST /restaurant/tickets/{id}/settle/worth` → `{"subtotal":4331.30,"tax":736.32,"total":5067.62,"due":5067.62}` | **FAIL — $9** |

4,331.30 × 17 % = 736.32 — the dine-in path taxed the menu price as though it were **net**, at a shop
whose setting is `tax_inclusive: true` (read back from `/shop/settings` in the same minute: `{"tax_inclusive":
true, "default_tax_rate": 17}`). The guest's Karahi is 1,799.00 at the counter and 2,104.83 at the table.
Worse than a wrong total: the 736.32 is 17 % of a figure that **already contains** 629.33 of tax, so the
Tax report will carry tax on tax.

### M16 — four taps on one dish, and only one of them is charged

| # | What was done | Expected | What happened | Verdict |
|---|---|---|---|---|
| T1 | 3 taps on QA Naan, **1,500 ms** apart | line 4 → 7 | POST + 2 PATCH `{"adjust":1}` → **7** | **PASS** |
| T2 | 4 taps on QA Naan, **250 ms** apart | line 4 → 8 | **1** PATCH; line **5**; badge 5; **3 taps lost, in silence** | **FAIL — $10** |
| T3 | 4 taps, **120 ms** apart | 5 → 9 | 1 PATCH; line **6** | **FAIL** |
| T4 | 4 taps, **800 ms** apart | 6 → 10 | 2 PATCHes; line **8** | **FAIL** |
| T5 | one tap on **four different** dishes, 200 ms apart | one of each | **4** requests, all four arrive | **PASS** — so it is not the pace, it is the sameness |
| T6 | 4 presses of the line's own **"+"** (`One more QA Naan`), 200 ms apart | 10 → 14 | **1** PATCH; line **11** | **FAIL** — the same loss on the other control |
| T7 | the same "+" 4 times, 1,500 ms apart | 11 → 15 | 4 PATCHes; line **15** | **PASS** |

Measured, not inferred: a capture-phase listener in the page counted the clicks that actually reached the
DOM — **4 of 4 every time** — against the requests the page sent (**1**). The dish's own tile badge is
drawn from the server's answer, so it agrees with the under-count: the waiter is told 5 naan and has no
way to know that three of their eight presses were dropped.

### M16 — the tab split two ways, and the tip

The order was rebuilt clean on **T2** (TAB-00002, 4 covers) after the probe tab was cancelled, each tap
confirmed against the server before the next (because of $10): Karahi ×1, Biryani ×2, Naan ×7, Lime ×3 →
running total **4,680.79** — exactly the hand figure. Sent to the kitchen (all four lines `fired`).

From here the arithmetic is worked in the shop's **own** (wrong — $9) exclusive mode, so that the split,
the tip and the drawer can still be proved. Tax accumulates line by line, rounded as it goes
(`TabBill`/`CreateSaleAction`): whole tab = 4,680.79 + **795.74** = **5,476.53**
(305.83 → +322.9966 = 628.83 → +39.6627 = 668.49 → +127.245 = **795.74**).

| # | What was done | Expected (worked out) | Settle sheet | API (sale) | Drawer | Verdict |
|---|---|---|---|---|---|---|
| R1 | Sheet opened, whole bill | sub 4,680.79 · tax 795.74 · bill **5,476.53** | "Whole bill Rs 4,680.79 · Tax Rs 795.74 · Bill Rs 5,476.53" | — | — | **PASS** (the figures are the server's own `settle/worth`, not the screen's) |
| R2 | **Split by items** — Biryani 2→0, Naan 7→2, Lime 3→0 | P1 = 1,799.00 + 66.66 = **1,865.66**; tax 305.83 → +11.3322 = **317.16**; bill **2,182.82** | "2 items Rs 1,865.66 · Tax Rs 317.16 · Bill Rs 2,182.82"; button "**Take Rs 2,182.82**" | — | — | **PASS** |
| R3 | **Tip**, the 10 % button | round(2,182.82 × 10)/100 = **218.28**; to collect **2,401.10** | tip box **218.28**; "Tip Rs 218.28 · To collect Rs 2,401.10"; button "**Take Rs 2,401.10**" | — | — | **PASS** |
| R4 | Took the 2,401.10 in cash | one sale of 2,182.82 with 218.28 of tip; the naan line splits 2 paid / 5 owed | sheet closed on the first press | INV-000002 `subtotal 1865.66` `tax 317.16` `total 2182.82` `tip_amount 218.28` `amount_paid 2401.10` `order_type dine_in` `table_no T2`; lines Karahi ×1 1,799.00 @17 %, Naan ×2 66.66 @17 %; one payment cash 2,401.10 | tendered 1,800 → **4,201.10**; cash sales 1,799 → **4,200.10**; **tips 218.28**; expected **6,400.10** = 2,200 + 4,200.10 | **PASS** |
| R5 | The tab after R4 | Karahi PAID, Naan ×2 PAID, Naan ×5 owed, Biryani ×2 owed, Lime ×3 owed | exactly that — the 7-naan line was split into a paid 2 and an owed 5 | running total still 4,680.79 | — | **PASS** |
| R6 | **Split by amount** — the rest, card 1,500.00 + cash the remainder | P2 = 1,899.98 + 166.65 + 748.50 = **2,815.13**; tax 323.00 → 351.33 → **478.58**; bill **3,293.71**; cash = 3,293.71 − 1,500 = **1,793.71** | "Bill Rs 3,293.71"; the sheet's own line read "**Rs 1,500 on card, Rs 1,793.71 on cash**" | INV-000003 `subtotal 2815.13` `tax 478.58` `total 3293.71` `tip 0.00`; payments **card 1,500.00 + cash 1,793.71** | tendered **5,994.81** · cash sales **5,993.81** · expected **8,193.81** = 2,200 + 5,993.81 · `tender_mix {cash 5,994.81, card 1,500}` | **PASS** — the card is in the mix and **not** in the cash |
| R7 | Σ the two parts | 2,182.82 + 3,293.71 = **5,476.53** = the whole bill; 317.16 + 478.58 = **795.74** = its tax; 1,865.66 + 2,815.13 = **4,680.79** = the food | all three hold **to the paisa** | tab **closed**, every line PAID | | **PASS** |

**Where the tip went** — it must land somewhere, once, and never be revenue:

| Place | Figure | Right? |
|---|---|---|
| Drawer | `tips 218.28`, and inside `cash_sales 5,993.81` → `expected_cash` **8,193.81** | **yes** — the guest handed it over in cash, so the till is holding it and the count must find it |
| **Waiter sections** (`/restaurant/reports/waiters`) | Rashid Owner · tables 2 · covers 8 · sales 5,476.53 · **tips_total 218.28** | **yes** — attributed to the person who earned it |
| Reports → Summary | revenue **7,275.53** = 1,799.00 + 2,182.82 + 3,293.71 — **no tip** | **yes** |
| Reports → Tax | net 6,218.40 + tax **1,057.13** = 7,275.53; and 261.39 + 317.16 + 478.58 = **1,057.13** | **yes** — and it reads the inclusive sale's net as 1,537.61 and the exclusive ones' as their subtotals, which is the one report that handles both modes correctly |
| Cashbook / Ledger | three rows 1,799.00 · 2,182.82 · 3,293.71, balance carried 1,799.00 → 3,981.82 → **7,275.53**, in the order they happened | **yes** — no tip, and no $4-style mis-ordering here |
| Dashboard today | revenue **7,275.53**, profit **3,164.40** — identical to Reports | **yes** |

Law 9 holds: the tip changed no revenue and no profit. Law 3 holds: expected cash 8,193.81 = float 2,200 +
cash sales 5,993.81, and the 1,500 of card is outside it. Law 7 holds: Dashboard today = Reports today.

### M16 — takeaway, then a delivery with a fee and cash on delivery through a rider

| # | What was done | Expected (worked out) | What each place said | Verdict |
|---|---|---|---|---|
| R8 | **Takeaway** tab (no table, named "Ahmed QA"): Naan ×2 + Lime ×1, settled cash | sub 66.66 + 249.50 = **316.16**; tax 11.3322 → 11.33, +42.415 → round(53.745) = **53.75**; bill **369.91** | sheet "Whole bill Rs 316.16 · Tax Rs 53.75 · Bill Rs 369.91"; INV-000004 `total 369.91` `order_type takeaway` `customer_name Ahmed QA`; drawer tendered **6,364.72** (= 5,994.81 + 369.91) · cash sales **6,363.72** · expected **8,563.72** | **PASS** |
| R9 | A **delivery order** taken on the phone screen (`/tenant/orders/new`): Karahi ×1 + Naan ×3, delivery, address typed. The fee was set to **149.99** on Settings → Business first | goods 1,799.00 + 99.99 = **1,898.99**; a phone order carries **no tax** (a known decision); + fee 149.99 → **to collect at the door 2,048.98** | the screen's own figure `order-total` = "**Rs 2,048.98**"; ORD-000001 `subtotal 1898.99` `delivery_fee 149.99` `total 2048.98` `payment_method cod` `payment_status unpaid` `status preparing` | **PASS** |
| R10 | **Out for delivery**, with the rider | it must ask who is carrying it | "Who is carrying ORD-000001? … Imran Rider +923001234567 · Free · Send without a rider · **Send with Imran Rider**"; order → `out_for_delivery`, rider **Imran Rider** | **PASS** |
| R11 | **Complete** (delivered, cash taken at the door) | the goods become a sale of **1,898.99**; the 2,048.98 is with the rider, not in the till | order `completed` `payment_status paid`; a sale **INV-000005** `subtotal 1898.99` `tax 0.00` `total 1898.99` `charges null`, one payment cash 1,898.99; Ledger row "Sana QA **1,898.99**", balance 7,645.44 → **9,544.43**; Summary revenue **9,544.43** = 7,645.44 + 1,898.99; the **drawer did not move** (tendered 6,364.72, expected 8,563.72) | **PASS** for the goods; the fee — see below |
| R12 | The **rider's statement** | they are holding the whole 2,048.98; of it, 149.99 is the fee they earned | `cash_in_hand` **2,048.98** · `rider_earned` **149.99** · one order · the screen's row said "Cash held **Rs 2,048.98 (1)**" | **PASS** |
| R13 | **Settle cash** — the rider hands it in ("Cash received") | the 2,048.98 arriving has to land somewhere | statement → **0**; `rider_settlement` written. But: drawer `cash_in` **0**, expected cash **still 8,563.72**; `/pos/session/movements` **[]**; Cashbook money_in **still 9,544.43**; Income **[]** | **FAIL — $11** |

**Where the fee went.** Asked of every book of the shop, after the money had been collected *and* handed
in: Summary revenue 9,544.43 (goods only) · other income **0** · Income list **[]** · Cashbook money_in
9,544.43 · Ledger five rows, none of them 149.99 · the sale carries no `charges` · no cash movement. The
149.99 the customer paid exists in exactly two places that are not a book: the `orders.delivery_fee`
column and the rider's own statement. So of the **2,048.98** taken at the door, **1,898.99** is in the
shop's books and **149.99** is in none of them — and the whole 2,048.98 can be handed over the counter
without a single figure in the shop moving.

---

### $9 · P1 · Dine-in / takeaway / tabs · A **tax-inclusive** shop's tab adds the tax **on top**

**Who and where** — Rashid Owner (and any waiter or cashier), Paisa QA Kitchen, tax **inclusive**:
the tab screen, the printed bill, the settle sheet and the sale it rings.

**Steps**
1. Settings → Tax & Delivery: "**Prices already include tax**" is on — the screen's own words are
   "*Inclusive: the price is the final price — the receipt shows the tax portion held within it*".
2. Ring **QA Chicken Karahi** (menu price 1,799.00) at the **counter** → total **1,799.00**. Correct.
3. Open a tab on a table, put the **same dish** on it, press **Settle**.

**Expected** (worked out) — the menu price is the final price, so the tab's share for that dish is
**1,799.00**, holding 1,799 × 17/117 = **261.39** of tax. For the four-line tab: bill **4,680.79**,
tax within it **680.12**, net **4,000.67**.

**Actual, in each place**
| Place | What it says |
|---|---|
| the tab's footer | "Running total **+ tax at the bill** Rs 4,680.79" |
| the settle sheet | Whole bill 4,680.79 · **Tax Rs 795.74** · **Bill Rs 5,476.53** |
| `POST /restaurant/tickets/{id}/settle/worth` | `{"subtotal":4680.79,"discount":0,"tax":795.74,"total":5476.53,"due":5476.53}` |
| the sale rung (INV-000002) | `subtotal 1865.66` `tax 317.16` `total 2182.82` **`tax_inclusive false`** |
| the counter, same dish, same minute (INV-000001) | `subtotal 1799.00` `tax 261.39` `total 1799.00` **`tax_inclusive true`** |
| `/shop/settings` | `{"tax_inclusive": true, "default_tax_rate": 17}` |

So the guest's Karahi is **1,799.00** at the counter and **2,104.83** at the table — 17 % more — and the
795.74 of "tax" is 17 % of a figure that already contains 680.12 of tax. The sale row stores
`tax_inclusive false`, so every report downstream believes it.

**Proof** — INV-000001 (counter, inclusive, 1,799.00) and INV-000002/3 (same shop, same hour, exclusive)
sit side by side in `/sales`; `/reports/tax` reads 1,537.61 net for the first and the subtotals for the
others, which is the one report that handles both and the clearest statement that one shop is trading in
two tax modes at once.

**Cause**
- `backend/app/Actions/Restaurant/SettleTicketAction.php:125` — the tab is rung with
  `'trusted_prices' => true` and **never passes `tax_inclusive`**.
- `backend/app/Actions/Sale/CreateSaleAction.php:334-335` — on the trusted path the mode is
  `(bool) ($data['tax_inclusive'] ?? false)`, i.e. **exclusive**, and only the untrusted path reads
  `setting('tax_inclusive')`. The comment above it explains the rule for an online order and a layaway
  quoted months ago; a dine-in tab is neither — it is this shop's own price list, today.
- `backend/app/Support/TabBill.php` — the printed bill is written to the same rule on purpose:
  "*tax is added on top, and rounded as it accumulates, line by line*". It is faithful to the sale, so
  it is wrong in the same direction, and the test it names (`TheBillIsWhatTheTillWillAskForTest`) passes
  while both are wrong together.

**Fix direction** (not done) — pass the shop's mode from the tab's settlement, the way the counter does:
`'tax_inclusive' => (bool) $tenant->setting('tax_inclusive', false)` in `SettleTicketAction`, and give
`TabBill::of()` the same flag so the paper and the till stay the one figure. The layaway/online reasoning
for defaulting to exclusive is sound and should stay — a tab just is not one of those cases. Worth a test
that rings the same product at the counter and on a tab at an inclusive shop and fails unless the two
totals are equal.

### $10 · P1 · Dine-in · Repeat taps on one dish are **swallowed**, so food is served and never charged

**Who and where** — any waiter, the tab screen's menu tiles **and** the "+" on an unsent line.

**Steps** — open a tab, tap **QA Naan** four times at a normal floor pace (about 250 ms apart).

**Expected** — four naan. The hook's own docblock (`panel/src/modules/dinein/hooks/useDineIn.ts:102`)
promises it: "*Taps are QUEUED, never refused… Deciding at the moment of the tap would have had eight
taps all looking at a tab with no naan on it*". And `dineInService.ts:197-199`: "*`adjust` is a STEP
(+1, −1), never a target. **Four quick taps are four requests that each say 'one more' and all arrive at
four**.*"

**Actual** — one request. The line goes up by **one**.

| Gap between taps | Taps | Requests sent | Line moved |
|---|---|---|---|
| 1,500 ms | 3 | 3 | **+3** ✓ |
| 800 ms | 4 | 2 | +2 |
| 250 ms | 4 | **1** | **+1** |
| 120 ms | 4 | **1** | **+1** |
| 200 ms, on the line's **"+"** button | 4 | **1** | **+1** |
| 200 ms, one tap on **four different** dishes | 4 | **4** | +1 each ✓ |

**Proof** — a capture-phase listener added in the page (test-side only) counted the clicks that reached
the DOM: **4 of 4, every time**, all on an enabled button, no toast, no console error, against **1**
request on the wire. The tile's badge is drawn from the server's answer, so it reads 5 when the waiter
pressed eight — the loss is **silent**. Four different dishes at the same pace all arrive, so it is not
the pace: it is the sameness.

**Cause** — `panel/src/common/api/client.ts:302-330` (`onceOnItsWay`) with `TWIN_SETTLES_MS = 1_000` at
`:283`. The twin key is `[method, url, params, Idempotency-Key, body]` (`twinOf`, `:287-300`). Four taps
on one dish are four **identical** `PATCH /restaurant/tickets/{id}/items/{item}` with the identical body
`{"adjust":1}` and **no** `Idempotency-Key`, so taps 2–4 are handed the first one's answer instead of
being sent — and a success is held for a second afterwards, which is why 800 ms loses half and 1,500 ms
loses none. This is B63's fix (`d714e4f`) doing exactly what it was built to do, on the one control where
pressing the same thing twice **means** two.

**Fix direction** (not done) — the guard cannot tell a double-click from a second deliberate press by
looking at the body, so the press has to say which it is. Either exempt a stepping write (give
`dineInService.updateItem` a per-press `Idempotency-Key`, which `twinOf` already folds into the key, so
each tap is its own write and the twin guard still protects the rest), or let `onceOnItsWay` take an
explicit "this one repeats" flag from the caller. **Not** by shortening `TWIN_SETTLES_MS` — that only
moves the line. Then test it the way it is measured above: N taps at 200 ms must be N requests.

### $11 · P2 · Delivery · The **delivery fee**, and the rider's cash, reach no book of the shop

**Who and where** — Paisa QA Kitchen, delivery fee **149.99**, the shop's own rider (Imran Rider,
RDR-000014), ORD-000001 paid **cash on delivery**.

**Steps** — take a delivery order (goods 1,898.99), send it out with the rider, press **Complete**
(delivered, money taken at the door), then Riders → **Settle cash** → "Cash received".

**Expected** — the customer handed over **2,048.98**. Both parts have to land somewhere, once: the
1,898.99 of goods as revenue, and the 149.99 fee as the shop's income or as something owed to the rider.
When the rider hands the cash in, the shop's cash has to move.

**Actual**
| Place | Figure |
|---|---|
| the screen, before it was taken | "To collect at the door **Rs 2,048.98**" |
| ORD-000001 | `subtotal 1898.99` · `delivery_fee 149.99` · `total 2048.98` · `payment_status paid` |
| the sale it made, INV-000005 | `subtotal 1898.99` · `tax 0.00` · `total 1898.99` · `charges null` |
| Ledger | one row, "Sana QA **1,898.99**" |
| Cashbook | money_in **9,544.43** before the hand-in and **9,544.43** after |
| Reports → Summary | revenue 9,544.43 · **other income 0** |
| Income list | **[]** |
| the drawer, after "Cash received" | `cash_in` **0** · expected cash **8,563.72**, unchanged · `/pos/session/movements` **[]** |
| the rider's statement | `cash_in_hand` 2,048.98 → **0** after settling; `rider_earned` 149.99 |

So **149.99** of money a customer paid is in no book of this shop, and the **2,048.98** that crossed the
counter when the rider handed it in moved no figure at all. A till that physically takes that cash will
count **2,048.98 over** its expected cash at close, and the shop has no entry to point at.

**Cause** — `backend/app/Services/RiderService.php` `settle()`: it writes a `RiderSettlement` row (and
stamps the orders) and nothing else — no `RecordCashMovementAction`, no income, no drawer. The fee is
never carried onto the sale either: `SettleTicketAction`/the order→sale path copies the items and the
discount but not `delivery_fee`, so the sale's `charges` stays null.

**Fix direction** (not done) — two decisions for the owner, and they are separate:
1. **Is the fee the shop's income or the rider's wage?** If the shop's: carry it onto the sale as a
   charge (so revenue, the receipt and the Tax report all see it) or post it as Other income. If the
   rider's: it should show as money owed to the rider, so the rider's wage is a figure and not a habit.
2. **The hand-in is a cash movement.** "Cash received" should record a pay-in against the open shift
   (`RecordCashMovementAction::record(...)`, as the khata and advance paths do) so the drawer expects it
   and the Cashbook shows it once. The screen's own sentence — "*This entry records the cash — it does
   not pay them*" — is the right promise; today it records the cash in a place no money report reads.

### M17 — a sale rung with no line, the price changed behind its back, then reconnected

Done on the Kitchen's counter (tax **inclusive**), in one run — a browser context's IndexedDB dies with
the context, so ringing and syncing had to happen in the same script. The till was first made ready
through the screen (Settings → Point of Sale → Lanes & PINs → **Save everything on this device** → "*This
device can sell offline — 4 products and 1 customers are saved on this device*"; the shop's offline window
reads **14 days**).

| # | What was done | Expected (worked out) | What each place said | Verdict |
|---|---|---|---|---|
| O1 | The line pulled out (`setOffline(true)`), then **QA Fresh Lime ×2 @ 249.50** rung, cash **500** | sub **499.00**; tax held within = 499.00 × 17/117 = 72.5042… → **72.50**; net 426.50; total **499.00**; change **1.00** | the till's header said "**Offline**"; chips Sub Total 499 · **Tax 72.50** · Grand Total **499**; "Change due Rs 1"; the slip **OFF-TILL-MJ83-000001** "Total Rs 499 · Paid Rs 500 · Change Rs 1" | **PASS** — and inclusive tax is right **offline** too, which is the half of M2 the counter proved online |
| O2 | Mid-outage, the shop changes the price: `PATCH /products/{lime}` → **299.50** (from plain Node, not the browser — another door, as a second device would be) | the server's price is now 299.50; nothing of the sale has reached it; the drawer has not moved | product price **299.50**; `/sales` still ends at INV-000005; drawer expected cash **8,563.72**, unchanged | **PASS** |
| O3 | The line put back (`setOffline(false)`) | the till sends itself, with no press | it landed in **2.5 s**, unprompted | **PASS** |
| O4 | **The price it is kept at** | 499.00 — the figure printed and paid — **not** 2 × 299.50 = 599.00 | INV-000006 `subtotal 499.00` `tax 72.50` `total 499.00` `amount_paid 500.00` `change_given` → drawer 2.00, `tax_inclusive true`; its one line **QA Fresh Lime ×2 at unit 249.50 = 499.00** | **PASS** |
| O5 | **Once** | exactly one sale of 499.00 | one (`/sales` filtered on 499.00 → 1); `offline_seq 1`, `offline_number OFF-TILL-MJ83-000001`, `synced_at 19:14:28` against `sold_at 19:14:22` | **PASS** |
| O6 | **Reports → Offline says so** | the sale named, flagged, with both prices | `{"sales":1,"total":499,"flagged":1,"beyond_window":0,"after_close":0,"clock_off":0}` and the row carries `offline_number`, `held_hours 0` and the violation in words: "***Sold at the till's price while offline: QA Fresh Lime at 249.50 (the price is now 299.50) × 2 — recorded as charged.***" | **PASS** — exactly the owner's rule (Q10/B47), in a sentence a shopkeeper can read |
| O7 | The chorus | drawer expected 8,563.72 + 499.00 = **9,062.72**; revenue 9,544.43 + 499.00 = **10,043.43**; tax 1,110.88 + 72.50 = **1,183.38** | drawer tendered **6,864.72** · change **2.00** · cash sales **6,862.72** · expected **9,062.72**; Summary revenue **10,043.43** · tax **1,183.38** | **PASS** |
| O8 | Which till rang it | the report's own purpose is "what came in late… and **from which till**" | `till: null`, `register: null` — though `pos_device_id` is stored and the device's **code** is `MJ83`, the one printed on the slip | **FAIL — $12** (P3) |

---

### $12 · P3 · Reports → Offline · The "which till" column is **blank** for every web till

**Steps** — ring a sale offline on a browser till and reconnect, then read Reports → Offline.

**Expected** — the row names the till. The till has a name the shop can read: the server allocates a
four-character **code** precisely "*so no two tills in one shop can share them*"
(`panel/src/modules/offline/device/deviceService.ts`), and it is printed in the middle of the offline
slip — **OFF-TILL-`MJ83`-000001**.

**Actual** — `till: null` and `register: null` on the row, while `pos_device_id` is stored on the sale
(`df636a71-…`). `/pos-devices` shows every self-registered web till with **`name: null`** and a good
`code` (`ZHUU`, `FY8P`, `DRLL`, `MJ83`…). So the column stays empty until somebody renames each device by
hand, on exactly the screen an owner reads the morning after an outage.

**Cause** — `backend/app/Http/Controllers/Api/V1/Tenant/OfflineReportController.php:146` (and `:201`,
`:236`): `'till' => $s->device?->name`. A device registers itself with no name; nothing falls back to the
code.

**Fix direction** (not done) — `$s->device?->name ?? $s->device?->code`, in all three places, so the
report prints the same four characters as the slip in the customer's hand. Renaming a till stays the
better answer and is already offered on that screen; this is only about the default.
