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

The same shop with thousands in it. Products go in through the Import screen;
sales are rung against the till's own endpoint, each paid at a figure the spec
works out from its own price list (half on a card, where one paisa wrong is a
refusal). Then the screens are opened on the result.

| # | Case | Expected |
|---|---|---|
| E1 | A file one row over the limit | refused whole, and says what the limit is |
| E1 | 2,000 products imported through the screen | "2,000 created", none failed; list says 2,006 items |
| E1 | One of 2,000 found by name and by SKU; list pages | price, cost, tax group as typed; page two is not page one |
| E3 | The till finds one of 2,000 and sells it | search under 8 s; card sale at the worked-out figure |
| E2 | 1,500 sales from two tills at once | every one charged the worked-out total and tax; 1,500 distinct invoice numbers |
| E2 | Every product is on exactly one of twenty pages | 2,000 rows, 2,000 distinct |
| E2 | Sales list: count, find by invoice number, pages | count = before + 1,500 |
| E2 | Every sale is on exactly one page | rows = count, all distinct |
| E4 | Reports gained exactly what 1,500 sales come to | Sales, Revenue, Sales Tax, Cost of Goods, Gross, Net = before + worked-out; Refunds and Expenses unmoved |
| E4 | Tax report | Tax payable and Gross sales moved by the same amounts |
| E5 | The shelf went down by what was sold | 80 items checked against 5,000 − sold; Inventory screen agrees |
| E6 | Every screen opens with thousands behind it | none refused, none blank, none over 12 s |
| E6 | No answer is heavier than a page of it should be | no GET over 400 KB on the main screens |

## Stage F — the admin again

Each change is made on the admin's screen and then looked at from the owner's.

| # | Case | Expected |
|---|---|---|
| F1 | Usage & limits reflect what the shop did | products 2,006 · branches 2 · staff 1 · orders this month = every bill rung |
| F2 | A module is switched off (Coupons & Promotions) | gone from the owner's menu; every remaining entry opens; typing the address shows no screen |
| F2 | The till with promotions off | soap at shelf price (630, was 504); the server charges the same |
| F2 | Switched back on | menu entries return; the coupon and promotion are as they were left; the till gives 504 again |
| F3 | Suspended | listed as suspended; the owner's open session lands at sign-in; signing in says "suspended" |
| F3 | Activated | the owner signs in; every sale is still there |
| F4 | The admin's audit log | found by the BUSINESS's name; says which shop was suspended and activated; a module change reads "Coupons & Promotions: on → off" |

## Stage G — settings, and whether anything listens to them

A setting has three chances to be broken: it does not save, it does not
survive a reload, or nothing reads it. Every case changes the setting ON the
Settings screen, reloads, and then goes to the place the setting is about.
Each puts the shop back as it found it.

| # | Tab | Case | Expected |
|---|---|---|---|
| G0 | all | Every tab and POS sub-tab opens | a section drawn on each; nothing refused |
| G1 | Counter | Default payment | the tender sheet opens on it |
| G1 | Counter | Round cash bills | cash lands on the coin, a card does not; the server agrees |
| G1 | Counter | Ask who served | the till asks; the sale records it; off → no box |
| G1 | Counter | Auto-print | the receipt is sent without pressing Print |
| G1 | Counter | Lock when idle (3 min, real clock) | open at 1 min, locked after 3, and says why |
| G1 | Counter | Tips | the till asks; the tip is in what is handed over, not in the bill or the tax |
| G2 | Counter | Require open shift | no drawer, no sale — at the till and by API; with a drawer, sold |
| G2 | Counter | Blind close / typed total / declare card totals | the close sheet shows each; variance 0 |
| G2 | Counter | …and the other way round | counted by note, expected shown, no machines asked |
| G3 | Counter | Discount limit (as the cashier) | stopped above the ceiling, told why in words; inside it, sold |
| G4 | Lanes & PINs | Till PIN | set; a wrong PIN refused ONCE; the right one hands the till over; the owner's session ends; next sale is the cashier's |
| G4 | Lanes & PINs | Till PIN removed | the list says "password only" |
| G5 | Lanes & PINs | Register added / removed | the till asks which lane, remembers across a reload, stops asking |
| G6 | Quotes & advances | Validity, terms, minimum advance | the date and terms on the paper and the server; the minimum held by till and server; the paper timed by the shop's clock |
| G6 | Quotes & advances | Quotations off | not offered at the till, refused by the server |
| G7 | Kitchen | Stations typed a line at a time | "Kitchen", Enter, "Hot Grill" stays as typed and saves as two |
| G8 | Tax & Delivery | Default tax | an item with no rate of its own moves; one on a tax group does not |
| G8 | Tax & Delivery | Prices include tax | 2,850 paid, 434.75 of it tax |
| G8 | Tax & Delivery | Delivery limits | what the shop set is what a customer's app is told |
| G8 | Tax & Delivery | Pickup and delivery both off | refused, in words; nothing saved |
| G9 | all | Save on one tab | does not put back a setting changed elsewhere meanwhile |
| G10 | Loyalty | Earn and redeem | earned on goods not tax; redeemed at the shop's value |
| G11 | Receipt | Header, footer, NTN, STRN, FBR id, who served, size | on the live preview before saving, and on a real receipt after |
| G12 | Barcodes | Label fields | the Labels screen follows the setting |
| G12 | Barcodes | Scale labels | rings the item at the weight on it — online AND offline; nothing when off |
| G13 | Hardware | A 58mm printer | its test page is a 58mm roll; receipts follow the printer over the shop default |
| G13 | Hardware | What a connection does | the form says so under the list |
| G13 | Hardware | Printer removed | receipts go back to the shop's own paper |

## Per business type

Stages A–G run for each type with ALL modules on. Each adds its own cases:

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
