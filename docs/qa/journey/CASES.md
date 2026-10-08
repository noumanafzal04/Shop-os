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

## Stage H — a restaurant's own day (`20-food-the-floor.spec.ts`, `JOURNEY_TRADE=food`)

Run after stages A and B for a food shop. Figures worked out in the spec:
2 × biryani (450) + 1 × lemonade (180) = 1,080; tax at 5% = 54; bill 1,134.
A takeaway biryani at the counter = 472.50.

| # | Where | Case | Correct means |
|---|---|---|---|
| H1 | Settings | Two stations (Kitchen, Bar) and 5% tax, saved through the screen | the server holds both |
| H2 | Products | A dish for each station | "Add item" opens as a DISH; "Made at" offers the stations; saved with price and station |
| H3 | Dine-in | Two tables laid out | adding one leaves "+ Add table" at hand for the next; both read Free |
| H4 | Tab | Seat two, order, note, send | two taps on a dish = ONE line of 2; the tile counts; a kitchen note; "Send to kitchen (3)" → two tickets, one per station; each printed slip has only its own dishes, the note on the cook's only, no prices; the floor tile says In kitchen, the bill and the guests |
| H5 | Kitchen | Work both tickets off the board | each starts in New; one row saying 2, with the note; Start cooking → Ready → Served moves it lane to lane; at Ready the floor tile turns "Food ready" |
| H6 | Tab | Settle | Whole bill 1,080 · Tax 54 · Bill 1,134; the sale is dine-in for 1,134; the table is Free |
| H7 | Till → Kitchen | A takeaway paid at the counter | 472.50; its kitchen slip prints; its card on the board is headed by the RECEIPT NUMBER; it is not a tab on the floor |
| H8 | Reports | The books | 2 sales, revenue 1,606.50, tax held 76.50 |

## Stage J — the menu deepens, and a bill is shared (`21-food-the-menu-and-the-bill.spec.ts`, `JOURNEY_TRADE=food`)

Run after stage H on the same shop. Figures worked out in the spec (tax 5%):
Karahi Half 900 · Full 1,600 · Extra naan +60. The table's tab comes to
5,300 (2 × Full with naan 3,320 · Half 900 · 2 × biryani 900 · lemonade 180);
the two bills are 2,215.50 and 3,349.50 = 5,565. A biryani is 0.25 kg rice
(300/kg) + 0.2 kg chicken (700/kg) = 215 a portion.

| # | Where | Case | Correct means |
|---|---|---|---|
| J1 | Products | A dish in two sizes | sizes are typed and Enter adds one WITHOUT creating the dish; each has its own price; the server holds both; the list shows where the price starts |
| J2 | Products | A required choice (Spice, exactly 1) and paid extras (up to 2) | the group says "required" / "optional" as it is set; saved; still there when the dish is opened again |
| J3 | Products | Ingredients on the shelf and a recipe | the two raw items are offered as ingredients; the server costs the dish at 215 from theirs; the form says so beside the price |
| J4 | Tab | Size, answer, extra | the tile says "from Rs 900"; both sizes offered at their prices; it cannot go on the tab until the choice is made; Full + naan = 1,660; a Half is ANOTHER line; the same again JOINS (one line of 2, 3,320); the two lines' buttons have different names; one ticket, and the cook's paper says Full, Half, Hot, Mild, Extra naan and no prices |
| J5 | Kitchen | The card | two Fulls on one row with hot and the naan; the Half apart, mild; worked off the board |
| J6 | Tab → Floor | The party moves table | only free tables (and its own) offered; same order, same 5,120, on the new table; the old one Free |
| J7 | Tab → Floor → Kitchen | Two tables are one party: merge | the other tab is offered; its lemonade arrives still "in the kitchen" (not rung again); 5,300; its table Free; the bar's ticket survives and now names the table he sits at; one open tab in the shop |
| J8 | Tab | Some of the bill now | the sheet names each line's SIZE and extras; opens on the whole 5,565; one Full + one biryani = 2,110 + 105.50 = 2,215.50 by card; the tab stays open with two lines Paid; the floor shows 3,190 still to pay |
| J9 | Tab | The rest, two ways | 3,190 + 159.50 = 3,349.50; 2,000 cash + 1,349.50 card on ONE sale as two tenders; the two bills are 5,565 to the paisa; both tables Free |
| J10 | Inventory | The recipe took its stock | rice down 0.5 kg, chicken 0.4 kg; the biryani on the bill carries a cost of 215; Inventory shows 9.5 |

## Stage K — a chemist's own day (`22-pharmacy-the-dispensary.spec.ts`, `JOURNEY_TRADE=pharmacy`)

Run after stages A and B for a pharmacy. No tax. Panadol 5 a tablet; Amoxil
20; Xanax 30; Nurofen 12.

| # | Where | Case | Correct means |
|---|---|---|---|
| K1 | Products | A medicine is carded | "Add item" opens as a MEDICINE; salt, strength, form; opening stock CANNOT be saved without an expiry; the stock is filed as a lot under the number typed |
| K2 | Inventory | A second lot, later date | no date, no lot; both listed with what is left; 300 on the shelf; the lot with twenty days left is named at the top of Inventory and is not called expired |
| K3 | Till | Scanned, first to expire first out | the till names the short-dated lot and its days; 120 sold = 600; lot A is empty and the last twenty came from lot B |
| K4 | Till → Dispensary | A prescription medicine | no prescription box until something needs one; the cashier is told and asked; Rx number, patient, prescriber and directions are on the sale; the register row has drug, quantity, LOT, patient, prescriber, Rx — and an over-the-counter sale is not in it |
| K5 | Till → Dispensary | A schedule-controlled drug | giving it a schedule makes it prescription-only; refused with no prescription, in words, nothing sold, stock untouched; refused with a number and no prescriber; sold with both; "Controlled only" lists it and not the Amoxil |
| K6 | Inventory → Till → Disposals | An expired lot | listed as EXPIRED (the live lot is not); 39 by count, 29 sellable — the 30th is refused with both numbers and the expired lot is untouched; removed from the top of Inventory as written off / expired; on the disposals list with why |
| K7 | Till | The brand is out | the tile says "Out — tap for same salt" and CAN be pressed; it is not rung; the sheet names what it is instead of, offers the same salt and strength with its stock, and not another salt; the equivalent goes on the bill at ITS price |
| K8 | Dispensary | A batch is recalled | nothing left to pull; one sale to call, for exactly the hundred that came from that lot; a walk-in with no phone is flagged; the lot behind it shows 180 in stock and the other twenty |

## Stage L — a phone shop's own day (`23-retail-the-serial-and-the-warranty.spec.ts`, `JOURNEY_TRADE=retail`)

Run after stages A and B for a retail shop. No tax. A phone is Rs 45,000 with
twelve months' cover; five arrive, numbered …801 to …805.

| # | Where | Case | Correct means |
|---|---|---|---|
| L1 | Products | A phone is carded to be sold by its number | no warranty box until "capture a serial" is ticked; the phone tracks serials with 12 months; a phone case does not |
| L2 | Purchases | Five arrive, each number written as it is unpacked | no one-press "Receive all"; six numbers for five boxes and a number written twice are each said and cannot be sent; three for five is allowed and says two will have none; the shop can name the five on the shelf |
| L3 | Till | The phone asks for its number | the line says IMEI 0/1; the units on the shelf are offered and a picked one is not offered again; the bill carries the number, 12 months, a year from today; THAT unit is sold and off the shelf; the sale's sheet says which unit and until when |
| L4 | Till | The unit just sold | not offered; typed by hand it is "not one of the units on the shelf"; the server refuses it in words and nothing is lost; the next customer straight after is not offered the phone that just left |
| L5 | Till | Tender with no number | the till asks before the money; "Sell without a number" is said, remembered, and not asked again; then a number and 24 months — and the bill carries both |
| L6 | Till | The IMEI on the box is scanned | that unit is on the bill, named; a second scanned joins the line (2/2); the same box again changes nothing; a number sold on Tuesday is said to be sold, and on which bill |
| L7 | Warranty desk | A year on, the phone and nothing else | covered, a whole number of days, the bill, the buyer, 12 months, a status in words; a number the shop never sold can still be taken in |
| L8 | Warranty desk | Taken in, held, closed | the buyer comes from the sale; no fault, no booking; not twice; on the holding list with days held; closed as Repaired with a note; the next lookup says it has been back once |
| L9 | Sales → Desk → Till | Refunded | the only phone on the bill needs no naming; it is on the shelf by its number; the desk says it came back (not "Under warranty"); the sale's sheet quotes no warranty for it; it is sold again and the desk answers for the new buyer |
| L10 | Sales | One of two comes back | the sheet asks WHICH and will not refund until told; a second tick cannot be made; that one is on the shelf, the other still covered |
| L11 | Sales | Swapped for another of the same | the unit handed back is named; the one going out has its number written (the shelf's unit is offered); one in, one out, the count unmoved; the desk answers for the new one and says the old one came back |
| L12 | Everywhere | The end of it all | five arrived, four out on standing bills, one on the shelf; the shelf count is the count of numbers; the till offers exactly that one; every unit out is covered at the desk |

## Stage M — a workshop's own day (`24-auto-the-car-and-the-job.spec.ts`, `JOURNEY_TRADE=automotive`)

Run after stages A and B for an automotive shop. No tax. Pads 4,500; labour
1,000 an hour; a diagnostic check 1,500; a battery 28,000; a tyre 14,000.

| # | Where | Case | Correct means |
|---|---|---|---|
| M1 | Products → Inventory | The shelf, and a tyre in two lots | labour is a service; the tyre's lots carry their DOT week; the 2019 lot is OLD and the 2026 lot is not |
| M2 | Vehicles | A car on record, and whose it is | plate (stored without the dash), make, model, what it takes — and an owner, by phone, shown on the list |
| M3 | Till → Vehicles | Tyres for that car | scanned, the till says how old the lot it will hand over is; the plate typed with a dash finds the car; the sale carries the car and 84,000 km; the OLD lot is the one sold from; the car's history has the bill and the reading |
| M4 | Till | A dead battery in part-payment | a tender, not a discount: the bill is still 28,000, 3,000 traded in and 25,000 cash; the scrap is one more on the shelf |
| M5 | Workshop | Booked into the bay | the plate finds the car and fills in its owner; nothing can be booked with nothing on the job; five o'clock is stored and shown as five o'clock; the card says whose, what is wrong and when it is due |
| M5 | Workshop | A plate nobody has seen | registered as it is booked in, and it belongs to the customer who brought it |
| M6 | Job card | Parts and labour go on | it says Job card, links back to the board, shows the car; pads, labour, a second hour, back to one and to two; a battery on by mistake and off; the job is 8,000 and so is its card on the board; nothing has left the shelf |
| M7 | Workshop | Along the board, and back | bay → being worked on → ready → back on the ramp → ready |
| M8 | Job card → Vehicles | Billed | a reading below the one it came in on is refused; billed 8,000 for all three lines, on the car, at 84,520, in the owner's name; the pads leave the shelf; the car is off the board; its history has both visits |
| M9 | Job card | A car with no arrival reading | the handover reading is still asked for and kept; the board is empty |

## Stage N — a petrol pump's own day (`25-petroleum-the-forecourt.spec.ts`, `JOURNEY_TRADE=petroleum`)

Run after stages A and B for a petroleum shop. No tax. Petrol 290 a litre
(carded at a cost of 265), diesel 285 (262).

| # | Where | Case | Correct means |
|---|---|---|---|
| N1 | Products → Tanks & pumps | Fuels by the litre; tanks, a pump, two hoses | no capacity, no tank; no meter reading, no hose; the fuel in a tank as it is installed is ON THE SHELF |
| N2 | Suppliers → Deliveries | A tanker | says who it came from; one dip is refused on the sheet; 10,000 invoiced, 9,900 by the dips, 100 short; cost 2,673,000 on what arrived; the petrol now costs (2,000×265 + 9,900×270) ÷ 11,900 = 269.16 and the diesel is untouched |
| N3 | Forecourt → Tanks & pumps | A shift starts | nobody need be named; meters open at 125,000 and 48,000, tanks at 11,900 and 6,000; the plant is frozen while it runs |
| N4 | Till | "Do hazaar ka daal do" | By rupees on an ordinary till, typed on its keyboard; ≈ 6.897 litres shown before it is set; the line says "for Rs 2,000"; charged 2,000 to the rupee; 20 litres of diesel as litres; 7,700 |
| N5 | Deliveries & rates | The midnight rate, entered at eight | At a time, midnight offered; an hour that has gone is refused; recorded and waiting — "Not at the pumps yet"; tonight's petrol is still 290 |
| N6 | Forecourt | Closed on every meter and every dip | not until every meter is read and every tank dipped; 26.897 L by meter, 5 tested, the same 26.897 at the till, nothing unbilled; 13.103 L short in the ground, said apart; the shelf is what the stick said; the plant is free and the meters stand where the shift left them |

## Stage O — a laundry's own day (`26-services-the-work-taken-in.spec.ts`, `JOURNEY_TRADE=services`)

Run after stages A and B for a services shop. No tax. Shirt wash and press
150; collar starch 50; suit dry clean 900; express press 100.

| # | Where | Case | Correct means |
|---|---|---|---|
| O1 | Products | What a laundry sells is work | each is a service; nothing tracks stock |
| O2 | Till | Three shirts pressed while they wait | 300, one line of 3 |
| O3 | Jobs | Eight shirts taken in | no registration, no odometer, no "parts", "labour" or "wrong"; nothing can be taken in with nothing on it; "What they want done", whose, their phone, back tomorrow at six; EIGHT typed, 1,200; six o'clock stored as six; on the board under Taken in with the name, the instructions and "Due … 06:00" |
| O4 | Jobs → job | Found by the number the customer says, and an advance | the phone said with spaces finds that one card and no other; a stranger is "No job in the shop matches"; the page says Job card, ← Jobs, Instructions, no car; Take an advance 500 cash; Advance paid on the job, with the payment |
| O5 | Job | The work grows | collars starched on, shirts typed up to 10 and collars to 10: 2,000; Balance due 1,500; the board card says Rs 2,000 |
| O6 | Job → Print | The slip | "Job Card", not Quotation or "Valid until"; Instructions and what they asked for; the customer; no car; Advance paid; "Total so far"; "not the final bill" |
| O7 | Jobs | Along the board, and back | taken in → being worked on → ready → back → ready |
| O8 | Job | Collected | "Take Rs 1,500"; no odometer asked; billed 2,000 for both lines, in her name; paid as 500 deposit + 1,500 cash; off the board |
| O9 | Job | Never collected | an advance of 300; "Cancel this job", nothing about a shelf, no fee assumed; 100 kept, Rs 200 shown as returned; cancelled with 200 refunded and 100 kept; the board is empty |

## Stage P — an online shop's own day (`27-online-the-order-from-the-street.spec.ts`, `JOURNEY_TRADE=online`)

Run after stages A and B for an online shop. No tax. Cake 2,400; brownies
900; cupcakes 600. Delivery Rs 200, nothing under Rs 1,000 delivered, free from
Rs 5,000. Stage A gives the shop every module, inventory with them, so its
bakes are counted onto the shelf at Inventory first. The customer is a second
browser that nobody has signed in to.

| # | Where | Case | Correct means |
|---|---|---|---|
| P1 | Settings → Inventory | The shop's terms, and its shelf | delivery fee on the profile; delivery on, minimum and free-delivery threshold saved; three bakes, priced and counted |
| P2 | Marketplace → the shop (signed out) | A stranger finds it | found by searching what it sells; every bake at its price; the page says Delivery Rs 200, Minimum order Rs 1,000, Free delivery above Rs 5,000; its kind by name, never a key |
| P3 | Checkout (every run, places nothing) | The whole price, before ordering | 900 for delivery: "add Rs 100 more, or collect it", Place waits; collected: Rs 900 and Place is offered; 1,500: Delivery Rs 200, "Add Rs 3,500 more and delivery is free", Total Rs 1,700 |
| P3b | Checkout → My orders | Placed | the shop has it at 1,700 with 200 delivery; My orders shows the lines, a Delivery line and the total, and where it is in words |
| P4 | Riders → Orders → My orders | Through its stages | a rider added; New → Confirm → Start preparing → rider → Out for delivery; the customer reads "On the way"; Complete; the sale is the goods (1,500) and the 200 left on the order is the delivery |
| P5 | Riders | The cash comes back | the rider holds Rs 1,700; the settlement lists the order and says Rs 200 of it is what the rider earned; nothing held after |
| P6 | My orders → Orders | Changed their mind | a cake to collect, placed and cancelled by the customer while new; Cancelled on the shop's list with nothing to move it on to |

## Stage I — the day is closed off by mistake (`13-a-day-closed-by-mistake.spec.ts`, mart)

Run on the mart shop after stage G. The drawer is counted through the API
here — counting is stage C's subject and stage G's; in this stage it is
plumbing between the two things it is about.

| # | Where | Case | Correct means |
|---|---|---|---|
| I1 | Till → Day & banking | A morning's sale, the drawer counted, the day closed off | the day says the hour it runs until; the close sheet says BEFOREHAND there is a way back; afterwards the screen names the closed day — not "No day open yet" — and offers Open today again |
| I2 | Till | A shift on the closed day | refused, and the refusal says a manager can open the day again from Day & banking; no shift opens |
| I3 | Day & banking → Till | Opened again | nothing without a reason, and two letters is not one; the SAME day is open and says it was closed and opened again, with the reason; a second shift sells in it |
| I4 | Activity | The trail | one line: Trading day · opened again · the reason |
| I5 | Day & banking | Closed off properly | the day is both shifts and both sales; that it was opened again stays on it |

Stage G's two drawer cases no longer stand aside on the day stage C closes
the shop: the day is opened again, as a shop would.

## Results

Recorded per run in `docs/qa/journey/RUNS.md`: date, type, cases passed,
product bugs found and fixed, harness faults.
