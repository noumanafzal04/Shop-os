# The journey — QA cases, in the order a business actually lives

**Asked for 2026-10-05:** test the product the way a person uses it — every
business type, every screen, every module, through the UI, in the order the
system works; check that what was entered is what comes back; at volume; fix
what breaks.

One run = one business, created by the platform admin and then run by its
owner. Each stage builds on the one before it. The suite is
`panel/e2e/journey/*.spec.ts`; a stage is a file, a case is a `test`.

## How "correct" is judged (applies to every case)

| Check | How |
|---|---|
| The entry was accepted | the screen's own success state, not a 2xx |
| It is on the list | found by name on the list screen after a reload |
| It is the SAME data | every field typed is read back, from the screen and from the API |
| The money adds up | totals on screen = the sum of what this run did, to the paisa |
| Nothing was refused | every API response ≥ 400 and every console error during the case fails it, unless the case declared it expected |
| It survives volume | the same screens with thousands of rows: lists page, search finds, totals unchanged |

## Stage A — the platform admin

| # | Case | Expected |
|---|---|---|
| A1 | Admin signs in | lands on /admin |
| A2 | Create a business: type, plan, city, owner, opening payment, EVERY module switched on | created; no field refused |
| A3 | It is in the Tenants list, active, on that plan | row found by name |
| A4 | Its detail page shows every module on and the plan's limits | all switches checked |
| A5 | The opening payment is in Billing & Payments | amount + reference match |
| A6 | The creation is in the Audit Log | entry names the business |

## Stage B — the owner's first day (setup)

| # | Case | Expected |
|---|---|---|
| B1 | Owner signs in with the temp password; finishes setup if asked | lands on the shop dashboard |
| B2 | Every sidebar entry a full shop should have is present and opens | no redirect to dashboard, nothing refused |
| B3 | Settings: business profile, default tax, receipt; saved and read back | values persist after reload |
| B4 | Tax groups created | listed with the rate typed |
| B5 | Categories created | listed |
| B6 | Products by hand — plain, taxed, wholesale, quantity break, sizes, packs, weighed, service | each on the list with its price; each rings on the till |
| B7 | Products by CSV import (thousands) | count on the list rises by exactly the file's rows |
| B8 | Suppliers | listed |
| B9 | Purchase order → receive | stock rises by the quantity received; supplier is owed the total |
| B10 | Stock: adjust, stocktake, write-off, transfer | each moves the figure it names and nothing else |
| B11 | A second branch, a lane, a cashier with a PIN | listed; cashier can sign in |
| B12 | Customers, groups (member %, trade level), credit limit | listed |
| B13 | Coupon, promotion, bank offer | listed, active |
| B14 | Expense, income, their categories | in the cashbook on the right day |

## Stage C — a trading day

| # | Case | Expected |
|---|---|---|
| C1 | Open a shift with a float | drawer shows the float |
| C2 | Sales on every tender: cash, card, wallet, split, khata | each completes at the figure shown |
| C3 | Sales with a member, a trade customer, a coupon, a promotion, a keyed discount, a line discount | bill = server's bill |
| C4 | Hold → resume; quote → convert | same bill; one sale |
| C5 | Sales ledger shows every sale of the day with the right total and tender | count and sum match |
| C6 | Return, exchange, void | stock back; refund on the drawer; totals move by exactly that |
| C7 | Khata: balance after credit sale; receive a payment | balance falls by the payment |
| C8 | Phone order → advance → rider → delivered | stock down; order in the ledger |
| C9 | Drawer movements; close shift with a count | variance = counted − expected |
| C10 | Day & banking: close the day, bank the cash | day closed; deposit recorded |

## Stage D — the books agree with the day

| # | Case | Expected |
|---|---|---|
| D1 | Dashboard today = sum of C | sales, count, cash |
| D2 | Reports: summary, tax, margins, by staff, stock value, purchases | each equals what the stages did |
| D3 | Inventory after the day | opening + received − sold + returned ± adjustments |
| D4 | Activity trail | has the settings, price and credit changes made above |
| D5 | Every screen once more, now with data | nothing refused, nothing blank |

## Stage E — volume

| # | Case | Expected |
|---|---|---|
| E1 | Thousands of products on the shelf | Products list pages; search finds one by name and by SKU |
| E2 | Thousands of sales | Sales list pages; totals = sum; a sale found by invoice number |
| E3 | The till with a full catalogue | search returns in time; a sale completes |
| E4 | Reports and dashboard at that volume | load, and still agree with the sum |

## Stage F — the admin again

| # | Case | Expected |
|---|---|---|
| F1 | Tenant usage and limits reflect what the shop did | counts match |
| F2 | Switch a module off → the owner loses the screen and nothing bounces | sidebar entry gone |
| F3 | Suspend → owner cannot work; activate → can | refused with a reason, then works |

## Per business type

Stages A–F run for each type with ALL modules on. Each adds its own cases:

| Type | Extra cases |
|---|---|
| Mart | scale/weighed items, wholesale customers, promotions |
| Food | menu with modifiers and sizes, recipes, tables → tab → KOT → kitchen board → settle and split, takeaway docket |
| Pharmacy | batches and expiry (FEFO), schedule-controlled sale needs Rx, substitute |
| Retail | serial/IMEI capture, warranty lookup, variants |
| Auto | vehicles, workshop board, trade-in tender |
| Petroleum | tanks, pumps, forecourt shift with meters and dips, tanker delivery, sale by amount |
| Services | service items, portfolio, jobs board |
| Online | no till: orders only, storefront listing |
| Finance | books only: expenses, income, cashbook, ledger |

## Results

Recorded per run in `docs/qa/journey/RUNS.md`: date, type, cases passed,
product bugs found and fixed, harness faults.
