# The journey — runs

One row per run. A "product bug" is something a shop would have met; a
"harness fault" is the test being wrong, and is listed so nobody reads a red
run as the product's fault twice.

| Date | Trade | Shop | Stages | Cases | Result |
|---|---|---|---|---|---|
| 2026-10-05 → 06 | mart | QA Mart 1005-231446 | 01–12 (A–G) | 105 — stages 01–09: 55 · 10: 13 · 11: 7 · 12: 30 | every stage green on its last run |
| 2026-10-06 | mart | QA Mart 1006-132842 (new, from stage 01, one sitting) | 01–12 (A–G) | 105 | 103 passed · 2 not run (see below) · 0 product failures |

Not yet run: the other eight trades.

### The fresh run, from the top, in one sitting (2026-10-06)

A new business created by the admin and lived through to the end of stage G
without stopping: 2,006 products, 1,500 volume sales, every setting.

- **103 of 105 passed.** No product fault.
- **2 not run, by the product's own rule.** Stage C closes the shop's day; in
  one sitting, stage G arrives the same afternoon, and a closed day takes no
  more shifts ("Trading on 2026-10-06 has already been closed off"). The two
  cases that close a shift need a new day. The till said exactly that, in
  words, and stayed shut — correct.
- **One thing it showed that a shop should be told sooner.** "Close off the
  day" said only that the figures freeze. It did not say no shift can be
  opened again today — and a shop that requires an open shift to sell could
  not ring another sale until tomorrow. The sheet now says so before the
  button. **There is no way to reopen a day closed by mistake**; that is left
  as a decision (below).

## Mart, 2026-10-05 → 06

### Product bugs found and fixed

| # | Found at | What a shop met | Fix |
|---|---|---|---|
| 1 | D2 | Profit on Reports and the Dashboard included the sales tax | tax is its own card; gross = revenue − refunds − tax − cost |
| 2 | C / D | A sale lost its customer's name; a returns box said NaN; a cashier's every screen logged a 403; closing a shift logged a 409 | fixed (see HANDOVER, 2026-10-05) |
| 3 | E2 | **Paging lost rows.** 2,000 imported products paged back as 1,989 — eleven on no page, eleven on two. 45 lists sorted by a date alone | `->stably()` before every `paginate()` |
| 4 | F2 | **A switched-off module's rules still fired.** Promotions off: till Rs 630, server Rs 504, sale refused. Same offline | server + offline engine ask what the shop HAS |
| 5 | F4 | The admin audit log did not say WHICH shop; a module change was the whole module map as JSON, twice; every sign-in filled the log | Business column + search, readable diff, sign-ins not logged |
| 6 | reported | **A discount on one cart row landed on another.** After a reload mid-sale two rows shared a key: discount, quantity and REMOVE hit both | line keys issued in one place; restored carts re-keyed |
| 7 | reported | **Thermal 80mm printed A4.** `@page { size: 80mm auto }` is not CSS; browsers drop it. Receipt, Z-read, quote, kitchen ticket, test print | valid size + the page fitted to the receipt's length |
| 8 | G1 | "Ask for a tip at checkout" did nothing at the counter till | a Tip box; tip in what is handed over, never in the bill |
| 9 | G9 | Saving Settings put back anything changed elsewhere since the screen opened | Save sends only what this screen changed |
| 10 | G4 | **One wrong PIN was sent to the server twice** — frozen out in half the tries | the client only retries a 401 that names the session |
| 11 | G6 | **Every printed time was UTC** — a 12:47 PM sale printed "07:47 AM"; after midnight, the day before | `ShopTime::show()` on every printed moment |
| 12 | G6 | The kitchen ticket never printed the shop's name; a quotation printed "Customer  Customer · 0300…" | `business_name`; `Customer::knownName()` |
| 13 | G7 | Kitchen stations could not be TYPED on two lines; "Hot Grill" became "HotGrill" | the box keeps what is typed |
| 14 | G6/G7 | Four text areas had no accessible name | `NamedTextarea` + a guard |
| 15 | G12 | **Offline, a scale's label rang nothing** — a mart could not sell what it weighs with the line down | the till reads the label itself, held to server fixtures |
| 16 | G13 | The device form offered seven connections as if the till used them | the form and Help say what each really does |
| 17 | reported | **"The POS invoice comes out like a kitchen receipt."** It was the kitchen ticket: printed the moment a counter sale is paid, with nothing saying whose paper it was | the sale sheet says which paper went out; the slip says KITCHEN COPY; receipt first, then the slip |
| 18 | reported (same picture) | The kitchen ticket was cut across two slips, the last modifier alone on the second — a regression from fix 7 the same day: measured wider than it printed | measured at the paper's own width |
| 19 | reported (same picture) | The ticket printed itself on load, so one sale could raise two windows; with both auto-prints on, one of the two papers could be dropped | one print at a time; a document may not print itself |
| 20 | reported | "Invoices are stuck to the edges." A roll's 3mm page margin was inside what an 80mm head cannot print, and "Margins: None" in the print window removed it altogether | 5mm kept by the document itself, on every side |
| 21 | while there | The roll invoice was set in the kitchen ticket's typewriter face, in grey a thermal head cannot print | a document's face, black only, a title band, a ruled total |
| 22 | while there | Sales and customers CSV exports were timed in UTC | on the shop's clock |
| 23 | deploy | **Three type errors reached the server and stopped a build.** Checked with `tsc --noEmit -p tsconfig.json`; the build runs `tsc -b`, which also reads the specs and refuses unused locals | fixed; `npm run build` is run before a push |

| 24 | reported | **Old tickets led the kitchen board for ever**, and nothing but three taps each took one down | the board is this service (`ServiceDay`); leftovers counted; one press clears them, marked `cleared` |
| 25 | while there | "Bills running" on the dashboard counted paid counter orders; a cleared or voided docket could be bumped back onto the pass | fixed with the above |
| 26 | reported | The floor said "occupied" and nothing else; a takeaway tab vanished when you stepped back; last night's open tab looked like tonight's | a tile says what the table needs; a Takeaway row; "From earlier" + close in one press |
| 27 | reported | **The order-taking screen: eight naan was eight taps and eight lines; no kitchen note could be typed anywhere; the order ran off the side of a tablet** | taps join one line, − / +, Kitchen note, Send to kitchen; `min-w-0` |
| 28 | reported | No menu on the floor / tab / kitchen; on a rail of icons a group's button did nothing on a tablet | the icon rail stays; touching a group opens it |
| 29 | while there | **Every "Try the demo" shop was stocked with items of an invalid type** — a restaurant demo's menu was empty to its own screens, and it had no tables | built through the product form's own action; a floor, sections and stations |
| 30 | harness | `food.chrome.spec` took "the first dish"; the first became a pizza that needs a crust, the refusal was not read, and all twelve checks failed about a board with nothing wrong | chooses a dish that can be ordered as it is, and reads the answer |

| 31 | H2 | **"Add item" opened as a Physical product in a restaurant** (and at a chemist's): stock tracked at nought, no "Made at", no recipe — a dish added without noticing the type row could not be sold | the form opens on the FIRST kind the shop is offered, which is its trade's own |
| 32 | H7 | An unnamed takeaway's kitchen card was headed "Takeaway" like every other one, and the receipt number — the one thing that tells two apart — was not on it | headed by the receipt number; a named one carries it beside the name |
| 33 | H3 | After the first table was added, "+ Add table" vanished with the empty floor | adding a table leaves the layout open until Done |

### Harness faults (the test was wrong)

- Stage E: an Inventory quantity is printed "4999", not "4,999" — the shop's quantity format has no separators on purpose.
- Stage E: `/pos/bootstrap` + `/pos/catalog` are 688 KB each on a device's FIRST load — the offline catalogue, a thousand at a time. By design; now measured by its own case.
- Stage F: forty-six full reloads in forty seconds is past one person's 240 requests a minute. Paced.
- Stage G: a faked clock never locked the till; a real one does at three minutes.
- Stage G: after a PIN hand-over the owner's saved sign-in is dead by design; the kit now checks a session is ALIVE, not merely young.
- Several locators (a `main` landmark that does not exist; an option whose greyed hint is also the word "Weight").

### Open, for a decision

1. **When does a shop's day end?** Reports, the dashboard and the ledger cut days at midnight UTC — 5 AM in Pakistan. A sale at 1 AM is in the previous day's figures; its receipt (now) says today's date. Sensible by accident for a shop that closes at 2 AM; wrong for a zone that is not +5, and wrong at the month's first five hours. Recommended: a shop-local day boundary, stated in Settings.
2. **A scale's PRICE label is read as hundredths** (02700 = Rs 27.00), so a label cannot say more than Rs 999.99 — less than a kilo of meat. Scales here are usually set to whole rupees. Recommended: a "decimals on the label" setting (0 or 2).
3. Printed terms / stations boxes and the label-field chips now have names and states; a page-wide `main` landmark is still missing.
4. **A day closed off by mistake cannot be reopened.** With "Require open shift" on, the shop cannot sell again until tomorrow. Recommended: an owner-only "reopen today" that is allowed only while nothing has been banked against the day, and is written to the activity trail.


## Breadth — every other trade, stages 01–02 (2026-10-06)

`JOURNEY_TRADE=<trade> … e2e/journey/01 e2e/journey/02`: the admin creates the
business, the owner signs in, and every screen the trade is offered is opened.

| Trade | Cases | Result |
|---|---|---|
| food | 8 | 8 passed |
| pharmacy | 8 | 8 passed |
| retail | 8 | 8 passed |
| automotive | 8 | 8 passed |
| petroleum | 8 | 8 passed |
| services | 8 | 8 passed |
| online | 8 | 8 passed |
| finance | 8 | 8 passed |

64 of 64. Nothing refused, no page error, no blank screen. This is breadth
only — each trade's own flows (the floor, the dispensary, the forecourt, the
bay board) are stage 20 onward and are not run yet.


## Stage H — a restaurant's own day (2026-10-06)

`JOURNEY_TRADE=food … e2e/journey/01 e2e/journey/02 e2e/journey/20`, a fresh
shop ("QA Food 1006-…"), one sitting.

| Stage | Cases | Result |
|---|---|---|
| A — the admin creates it | 6 | 6 passed |
| B — the owner opens it | 2 | 2 passed |
| H — the floor, the tab, the pass, the bill | 8 | 8 passed |

16 of 16, after three product faults (31–33 above) were fixed on the way: H2
stopped the first run, H7 the second, H3 the fresh one. Each was fixed and
the stage continued on the same shop from the case that had stopped — a
journey is lived once, so a stage is not re-run from its top on a shop that
has already settled its bill.

Not in this stage yet, from the list in CASES.md: sizes and modifiers on a
dish, recipes, splitting a bill, moving and merging tabs.


## Stage I — a day closed by mistake (2026-10-07)

`JOURNEY_TRADE=mart … e2e/journey/13`, on the mart shop lived on 2026-10-06.

| Stage | Cases | Result |
|---|---|---|
| I — closed at the wrong hour, opened again | 5 | 5 passed |
| G2 — the three drawer cases, run on a day closed off first | 3 | 3 passed (were 1 run + 2 stood aside) |

Then the stage was broken six ways in the browser — the screen saying "No
day open yet", the closed day never reaching it, the "opened again" line,
the way back on the close sheet, the hour the day ends, the till's refusal
naming the way out — and failed each time.

Findings 34–39, all from one root (the server's "today" is not the shop's):

| # | Found at | What a shop met | Fix |
|---|---|---|---|
| 34 | the owner's question | Reports cut the day at 05:00, the till and every "Today" at midnight: at 1 am "Today" on the sales list was empty while the dashboard kept counting | one hour for all of them, 05:00 unless chosen (`ShopDay`) |
| 35 | reading the till | A shift opened after midnight started a SECOND trading day beside the evening's | it joins the evening's day while that is open |
| 36 | the owner's question | A day closed by mistake could not be opened again | today's can, with a reason, by whoever may close it |
| 37 | while there | A medicine that expired yesterday was sellable until 5 am | expiry is judged by the date on the shop's wall |
| 38 | while there | A quotation past its date had not lapsed; a bill due today was not due and could not be posted; a bill dated today was "in the future" | the same |
| 39 | the owner's question | A scale's price label read as paisa — Rs 450 rang up as Rs 4.50 | whole rupees by default |


## Stage J — the menu deepens, and a bill is shared (2026-10-07)

`JOURNEY_TRADE=food … e2e/journey/21`, continued on the food shop lived
through stage H on 2026-10-06.

| Stage | Cases | Result |
|---|---|---|
| J — sizes, a required choice, extras, a recipe, move, merge, split bill | 10 | 10 passed |

Sizes, required choices, extras, joining, the kitchen's paper, moving and
merging, part-settling, two tenders on one bill and recipe depletion all did
what a restaurant needs, to the paisa. Two things a shop would have met:

| # | Found at | What a shop met | Fix |
|---|---|---|---|
| 40 | J8, reading the screen before the case was written | **The sheet a bill is split on named a line by the dish alone** — a table with a Half and a Full saw "Karahi" twice, told apart only by price, and every button on either line had the same name | one name for a line wherever it is named: dish, size, and what was chosen with it (`lineName` / `lineSpoken`) |
| 41 | J7 | The merge sheet read "Choose a tab" over an empty list while the open tabs were still being fetched — on a slow line, "no other table is open" | it says Loading… until the list answers |
| 42 | harness | J7 read the merge list the instant the sheet opened | waits for the option |

Finding 40 has a re-runnable case of its own in `food.tab-order.spec.ts`
(desktop, tablet and phone), because a journey's bill is settled once.

Not in the food stages yet: a deal with a sized item at the table, per-size
recipes, 86-ing a dish mid-service, a tab handed over between waiters.


## Stage K — a chemist's own day (2026-10-07)

`JOURNEY_TRADE=pharmacy … e2e/journey/22`, on the pharmacy shop made by the
breadth run (stages A and B, 2026-10-06).

| Stage | Cases | Result |
|---|---|---|
| K — lots, first-to-expire, prescriptions, a controlled drug, an expired lot, a substitute, a recall | 8 | 8 passed |

Lots, FEFO, the prescription record, the controlled-drug fence (both halves
of it), the expired-stock fence, write-off and recall were right first time.

| # | Found at | What a shop met | Fix |
|---|---|---|---|
| 43 | K7 | **"Same salt, in stock" could not be opened by touch** — an out-of-stock medicine's tile was a disabled button, so the sheet built for exactly that moment was reachable only by keyboard | an out-of-stock medicine stays pressable at a chemist; the tile says what the press does |
| 44 | K7, on the screenshot | A notice about one customer's medicine ("Substituted with…", "℞ needs a prescription") stayed over the next customer's empty cart until somebody pressed ✕ | what is said of a line goes with its sale |
| 45 | reading the batch list | A lot that expires TODAY was marked EXPIRED from five in the morning | judged by the date on the shop's wall (`isPastDate`) |
| 46 | harness | K3 looked at the copy of the notice drawn for a phone; K6 looked for a written-off lot under "To claim" | looks at the one a cashier sees; looks under "Written off" |
| 47 | Help | Help said a bill could be "split evenly". It cannot — it is split by lowering lines, and paid two ways | the Help says what the sheet does |

Next: retail (serials, warranty), auto (vehicles, bay board, trade-in),
petroleum (meters, dips, a tanker), services, online, finance.



## Stage L — a phone shop's own day (2026-10-07)

`JOURNEY_TRADE=retail … e2e/journey/23`, on the retail shop made by the
breadth run (stages A and B, 2026-10-06).

| Stage | Cases | Result |
|---|---|---|
| L — numbered goods in, at the till, at the warranty desk, refunded, one of two back, swapped | 12 | 12 passed (after the fixes below) |

The warranty desk's booking and holding list, the "already sold" guard and
the per-line warranty override were right first time. Everything about a unit
**coming back** was not — the server could take a unit back by its number and
no screen ever said one.

| # | Found at | What a shop met | Fix |
|---|---|---|---|
| 48 | L2 | Goods-in: six numbers could be sent against five boxes (the red line said so, the button stayed lit); a number scanned twice was not said; "Receive all" shelved a box of phones with no number against any of them | the sheet refuses too many and twice, says what too few means; an order of numbered units or medicines is received on the sheet that asks |
| 49 | L5 | The till took the money for a phone with no number, without a word | Tender asks first; "Sell without a number" is something the cashier says |
| 50 | reading the till | It SENT numbers from slots the sheet no longer drew (two written, quantity back to one) — refused by the server with nothing on screen to delete | one list of numbers for what is shown and what is sent (`numbersOn`) |
| 51 | reading the till | One number could be written on two units of a bill until the server refused it | said on the sheet, and Tender opens it |
| 52 | L6 | **Scanning the IMEI on the box found nothing** — the one barcode a phone shop scans | `/pos/lookup` finds a unit by its own number; the line arrives with it written |
| 53 | L4 | The phone just sold was offered, by its number, to the next customer for thirty seconds | the list of units is refreshed with the sale |
| 54 | L9 | **A refunded phone stayed "sold" under its number** — on the shelf, refused at the till, and unreachable by any door once the sale was refunded; the desk read "Under warranty" with the old buyer's name | the return works out which unit came back, and asks only when it cannot know; the desk has a third answer, "this unit came back"; a data repair mends what the old desk left (`shopos:units-back-on-the-shelf`) |
| 55 | L11 | An exchange could not say which unit came in or went out; the replacement left with no number on its bill | both are said on the exchange sheet and on the server |
| 56 | L7 | "365.9999999999884 days left" | a count of days, on the shop's calendar; the last one is "Last day of cover" |
| 57 | reading the sale | Cover counted from the server's UTC date and judged in UTC; six months from 31 August ran into March | the date on the receipt, the shop's calendar, no overflow |
| 58 | L7 | The desk printed a sale status as the database holds it; a bare expiry date showed as the day before anywhere west of Greenwich | words; read as the day it names |
| 59 | L6, finding out why the IMEI would not scan | **Enter in the till's search rang the first item on the shelf** for any code that was not five or more digits, when it was typed faster than the list could answer — every trade, silently | Enter waits for the answer to what is typed (`enterKey.ts`) |
| 60 | reading the return | A number only ever typed at the till was forgotten the moment the unit came back — the till could not offer the phone just handed over | written down when it comes back |
| 61 | screenshot | The serial box on the till's sheet was 180px: fifteen digits in a box that showed twelve | it takes the row |
| 62 | harness | L3 asserted a figure only a first run records | asserted where it is measured |
| 64 | harness (regression run) | The retail till-offers check pressed Pay on "any plain item" — which was now the numbered handset, and the till rightly asked for its number first | a numbered tile is marked (`data-pos-numbered`) and is not "plain", as a sized one already was |
| 63 | harness (mutations) | A server mutation left a unit where no door reaches it, and fifteen later mutations were "caught" by that state instead of their own tests | the re-runnable spec's cases no longer run in series; the runner mends the shelf after each mutation; the fifteen were run again |

Re-runnable: `e2e/trade.sold-by-number.spec.ts` (retail project; 4 cases)
and `e2e/till-enter.spec.ts` (desktop; 6 cases).

Mutations: backend 59 (58 caught, 1 equivalent — a shop filter implied by the
product), panel unit 64 (all caught after two tests were sharpened and one
dead guard removed), browser 38 (37 caught; the 38th — the server's
fractional days — is floored by the panel before it reaches the screen and
is caught by the backend test).

Next: auto (vehicles, bay board, trade-in), petroleum (meters, dips, a
tanker, sale by amount), services, online, finance.


## Stage M — a workshop's own day (2026-10-07)

`JOURNEY_TRADE=automotive … e2e/journey/24`, on the automotive shop made by
the breadth run (stages A and B, 2026-10-06).

| Stage | Cases | Result |
|---|---|---|
| M — a tyre's age, a car and its owner, a trade-in, the bay board, a job that grows, billing at the handover reading | 10 | 10 passed (after the fixes below) |

DOT dating, oldest-lot-first, the trade-in as a tender (bill, drawer and scrap
stock) and the board's moves were right. The middle of a workshop's day — the
job itself — was not there.

| # | Found at | What a shop met | Fix |
|---|---|---|---|
| 65 | M6, reading the job card before the case was written | **A job card could not take a part or an hour of labour after it was booked in.** No endpoint, no screen — it was billed for the one line it arrived with. Workshops and every services shop (the Jobs board) | a job card takes a line, changes a quantity, drops a line while it is open; priced by the code that prices the booking |
| 66 | M6 | The job card's own page said "Quotation", led back to "Quotations & advances", and showed nothing about the car or what the customer said | it says Job card, leads back to the board, and shows the car, the complaint, the reading, the promise and the stage |
| 67 | M5 | A car promised for five in the afternoon was stored as ten at night (a zone-less time, read as UTC) — due five hours after it was late | the moment is sent (`instantOf`) |
| 68 | M3 | **The till could not put a sale on a car**: the vehicle box was drawn only for a loyalty member or a prescription | drawn whenever there is a bill |
| 69 | M2 | A car could not be given an owner from any screen — the list had the column, the form had no field | the form has owner phone and name |
| 70 | M5 | A plate registered at book-in or at the till stayed nobody's, though the job or sale named the customer; linking needs a permission a cashier does not have | an ownerless car takes the customer of the first job or sale that names one; an owner on record is never replaced |
| 71 | M9 | A car booked in with no odometer reading could not be given one when it left | asked for any job that has a car |
| 72 | harness | A service fixture was told whether it tracks stock, which a service may not be | said only for the part |

Re-runnable: `e2e/trade.job-grows.spec.ts` (trade-automotive; 3 cases — one
fixed car, booked in, grown, billed and gone each run).

Next: petroleum (meters, dips, a tanker, sale by amount), services (the Jobs
board for a laundry or tailor — the same job card, now able to grow), online,
finance.


## Stage N — a petrol pump's own day (2026-10-07)

`JOURNEY_TRADE=petroleum … e2e/journey/25`, on the petroleum shop made by the
breadth run (stages A and B, 2026-10-06).

| Stage | Cases | Result |
|---|---|---|
| N — fuels and plant, a tanker, a shift, sale by the money, the midnight rate, the close | 6 | 6 passed (after the fixes below) |

The shift's own arithmetic — meters against the till, book against the dip,
test litres, the plant frozen while it runs — was right first time, and the
closed shift's screen reads the way a station needs.

| # | Found at | What a station met | Fix |
|---|---|---|---|
| 73 | N2, the cost came out unblended | **A tank installed with fuel in it left the shelf at nought** until the first shift closed: diesel "out of stock" on the first morning with 6,000 litres in the ground | the shelf follows the ground wherever a dip is written (`FuelInTheGround`) |
| 74 | N2, reading the delivery | **A tanker never moved what the fuel cost** — only a purchase order did, and a forecourt has none | blended on what arrived, as a purchase order's is |
| 75 | N4, reading the till | **Selling fuel by the money could not be reached** on an ordinary till (keypad off, the default) | a By rupees chip on any line sold by weight or volume; the sheet takes a real keyboard |
| 76 | N5, reading the form | A rate could only be entered for the moment it was saved; the Help told the owner to be there at midnight | Now, or At a time — the server already held it until its hour |
| 77 | N2 | A delivery could not say who it came from (the column was there, always "—") | From, where the shop keeps suppliers |
| 78 | N2 | One dip without the other was dropped in silence, and the load received on the invoice | said on the sheet; cannot be sent |
| 79 | N1, reading the form | A tank's "Holds" listed the first fifteen items of the catalogue | every item |
| 80 | harness | N1 and N2 asserted dips that only hold before the tanker and the shift | assert what stays true; the rest where it is measured |
| 81 | harness | The journey's pump shop had been set up under fault 73 | healed through the shop's own doors: tanks re-dipped, the petrol's cost put where the fixed code leaves it |

Re-runnable: `e2e/trade.forecourt-counter.spec.ts` (trade-petroleum; 3 cases;
saves nothing).

Next: services (the Jobs board for a laundry or tailor), online, finance.

## Stage O — a laundry's own day (2026-10-08)

`JOURNEY_TRADE=services … e2e/journey/26`, on the services shop made by the
breadth run (stages A and B, 2026-10-06).

| Stage | Cases | Result |
|---|---|---|
| O — services on the shelf, a walk-in, eight shirts taken in, an advance, the work grows, the slip, the board, collected, never collected | 9 | 9 passed |

The faults below were found by reading each screen as a laundry while the
stage was written, and were fixed before it ran; it then passed first time.
The board's movement, billing and the advance as a tender (not a discount)
were right already.

| # | Found at | What a laundry met | Fix |
|---|---|---|---|
| 82 | O4, reading the job | **A job could not take an advance from its own page** — "Take instalment" was a layaway's — and an advance taken any other way was drawn nowhere on the job | "Take an advance"; advance, balance and payments drawn whenever a job holds money |
| 83 | O6, reading the slip | **The slip printed as a quotation**: "Valid until", quotation terms, nothing the customer asked for | a Job Card: Instructions / Customer said, the car if any, promised, Total so far, the advance, "not the final bill"; no quotation terms on a job |
| 84 | reading the cancel door | **A cashier could cancel a job and hand its advance out of the drawer** — refund permission was asked of a layaway only | asked of the money, not the kind |
| 85 | O9 | The cancel sheet spoke of goods going back on a shelf and offered the layaway's fee | worded for a job; no layaway fee |
| 86 | O3 | The board asked what is "wrong" with shirts, said "parts and labour", searched "a part or a labour item"; "That car could not be booked in" | the board's own words |
| 87 | O3, O5 | **Eight shirts could only be taken in as one**, then pressed up seven times; 3.5 litres could not be said | How many when taken in; a typed quantity on every job line |
| 88 | O4 | A full board had no way to find one customer's work | find by slip number, name, phone or plate |
| 89 | reading the deposit door | A job's refusals said "still owed on this layaway", "This layaway was cancelled" | they say job |

Re-runnable: `e2e/trade.work-taken-in.spec.ts` (trade-services; 2 cases;
clears its own customer's open work first). Browser mutations on it: 15/15.
One survived at first — "the find box finds nothing" — because the check
("only this card is left") ran on a board holding ONE job, where it is true
whatever the box does. The spec now keeps another customer's job on the board
and asserts there is more than one before it finds.

Not built, said honestly on its screen: staff commission (a salon's
per-stylist pay).

Next: online, finance.

## Stage P — an online shop's own day (2026-10-08)

`JOURNEY_TRADE=online … e2e/journey/27`, on the online shop made by the
breadth run (stages A and B, 2026-10-06), with a customer account made through
the storefront's own sign-up.

| Stage | Cases | Result |
|---|---|---|
| P — the shop's terms, a stranger finds it, the whole price, placed, through its stages, the rider's cash, changed their mind | 7 | 7 passed (after the fixes below) |

The first real-browser walk of an order from a stranger to the shop and back.
The order's stages, the rider, the sale on completion, the settlement and a
customer cancelling were right first time.

| # | Found at | What a customer met | Fix |
|---|---|---|---|
| 90 | P2 | **The shop's minimum order and free-delivery threshold were on the wire and on no screen** | on the shop's page and at checkout |
| 91 | P3 | **The checkout never said what delivery costs**; its total was the items | Items, Delivery (or Free), and a Total with delivery in it, per shop, before Place |
| 92 | P3 | An order below the minimum was sent to be refused: "add a bit more", no currency, no figure | the card says by how much and Place waits; the server's refusal names the rupees |
| 93 | reading the checkout | Delivery and collection offered whatever the shop does | only what the shop offers |
| 94 | P2 | The shop's kind printed as its key, `online_boutique` | its name, sent by the server |
| 95 | P3b | My orders: lines that did not add up to the total, and the status as a code ("pending") | Delivery and Coupon lines; where it is, in words |
| 96 | harness | **A new browser context takes the spec's storage state** — the "stranger" and the new customer were the shop owner | an explicit empty session |
| 97 | harness | The order number read with the next span's text glued on (`ORD-000001QA`) | `/ORD-\d+/` |

Looked like a fault and is the design: a completed order's sale is the goods;
the delivery charge stays on the order and is the rider's — P4 and P5 assert
it. And a bake nobody counted is out of stock, correctly: stage A gives this
shop the inventory module.

Browser mutations on P2/P3/P3b: 13 run, 13 caught — the checkout total,
delivery shown as free, an order below the minimum placeable, no minimum
message, no free-delivery hint, the shop page hiding its minimum and its free
threshold (2026-10-08); the category key, My orders' delivery line and status
words, collection charged delivery, the minimum never short, and the server's
category name (2026-10-09, the six left when the work was stopped).

## Stage Q — an office that only keeps its books (2026-10-10)

`JOURNEY_TRADE=finance … e2e/journey/28`, on a business the stage makes for
itself — "QA Finance 1010-124849", Basic, the Expense & Income module and
nothing else. The one trade whose subject is what is NOT switched on, so it
cannot begin on the everything-on shop stage 01 makes.

| Stage | Cases | Result |
|---|---|---|
| Q — a books-only business is made, the owner walks in, its menu, what it earns, money in, bills, the rent comes round, a ceiling passed, cashbook, ledger, report and front page, subscription and settings, a mistake put right | 13 | 13 passed (after the fixes below), 1.6 minutes |

Nothing was broken. Every request answered 200 and the backend's own
books-only walkthrough was green. What was wrong was that the product it had
bought spoke to it as a shop with a till, on every screen — and two things it
needed to be told were not on its front page at all.

| # | Found at | What an office met | Fix |
|---|---|---|---|
| 98 | Q1 | "Only what a **finance manager shop** can use" (and, for other trades, "a auto & tyre shop", "a retail store shop") | each trade says what it is: "a books-only business", "an auto workshop" |
| 99 | Q2 | Setup called it a business and its map still asked for "your shop address"; the look was saved "for your shop" | the map and the theme panel take the noun |
| 100 | Q2 | **"Nothing needs you right now" directly above "Attention needed · 1 to look at"** | the head and the panel read the same figures |
| 101 | Q2 | No tile for recording income — half of everything it does | Record income, first of its four |
| 102 | Q3 | **`/tenant/sales`, typed, drew the whole Sales screen around two refused requests** | behind the server's own module gate |
| 103 | Q3 | "Your shop" on the rail; Recent activity: "updated a tenant", "created a user" | "Your business"; the Activity page's own words |
| 104 | Q4 | Income: "money in **that isn't a sale**… your sales revenue is counted automatically". Expenses: "…your drawer" | said by what the business has |
| 105 | Q4 | **No income category for anything it earns** — Interest, Owner Investment, Rent Received, Supplier Refund, Other | Client Payments, Service Fees, Sales, Commission, Donations & Grants |
| 106 | Q5, Q6 | **Every cash entry: "you have no shift open — the drawer was not adjusted"** — the bill form held open; on income it REPLACED "Income recorded". "Cash (from till)" | a business with no till is handed no drawer sentence; "Cash" |
| 107 | Q7 | **A bill that had fallen due was on no front page** — a badge on a tab of another screen | the head of the dashboard, and a row that opens the Recurring tab |
| 108 | Q8 | **A budget passed was said once, to whoever typed the bill, and nowhere after** | the head of the dashboard, and a row that opens Budgets |
| 109 | Q9 | Cashbook: Sales and Refunds columns, empty for ever; "use the POS shift close"; four fixed windows | Income · Expenses; any window, the tax year and a custom range among them |
| 110 | Q10 | Ledger: chips for Sales, Refunds and Supplier paid | the kinds of line it can have |
| 111 | Q10 | **"Clear all" on the ledger cleared nothing** | the page replaces its filters, not merges them |
| 112 | Q10 | **The ✕ on the ledger's period sent a custom period with no dates — refused by the server.** A range counted as two filters; "Nothing moved in this period" could never be reached | the period is the page's subject, not a filter |
| 113 | Q11 | A row of one tab; the chart's days as thirty-one wire dates; "500000" | no tab row; "1 Oct"; "500,000" |
| 114 | Q12 | Subscription: Products, Orders, Registers, Offline selling counted against it; **"Offline selling 0 / 0" drawn as a usage bar (every shop)**; "Full" in red for one branch of one; 4.5% commission on online orders it cannot take; "MB Of Storage" | only what applies; rules in words; amber "All 1 in use"; no commission card |
| 115 | Q12 | Settings: an Online shop card saying it could not have one — in the words "Your plan is Expense Manager only", **shown to ANY shop without online selling** | no card for a business with nothing to list; a true sentence for the rest |
| 116 | Q12 | **The map was painted over the Save bar** — the Save button behind a map | the map keeps to its own layer |
| 117 | harness | Three assertions true only on the first morning failed every resumed run | asked only while they are true |
| 118 | harness | **The map check asked what was "on top" and was told "the button" under a map that covered it** — tiles take no pointer events | measured in pixels |
| 119 | harness | **A check inside "if not already filed" never ran on a resumed business**; the income toast replaced the success message and nothing read it | wording checked every run; the case reads what the business is told |
| 120 | admin specs | **Every screen waited on Google Fonts before its first paint** — found as a spec "taking 7.3s" with the API answering in 20 ms | the typeface is the app's own file; `docs/decisions/shopos-first-paint-asks-nobody.md` |

Right first time: the budget arithmetic, a recurring bill posted on its due
date with the next a month on from THAT date, the usual figure surviving a
different one, the ledger's balance carried across a window, the export being
the screen, and every total after an edit, a duplicate and a deletion.

Mutations: 106 run, 106 caught — 38 on the screens of the lived business, 12
that need a new business each, 18 by the backend's tests, 38 by the panel's.
Four survived first: one was a mutation of mine that changed nothing (PHP's
`true == 'never'` is true), and three were real — the map check (118), the
income message (119), and a font guard that accepted one subset declared
twice. Each was fixed and then caught.

**Every trade has now been lived once.** Next: the packaging gap (several
barcodes for one pack).

## Stages R and S, and every trade lived again under the new menu (2026-10-11)

Asked for before a three-hour absence: *"test everything with real data on UI
and also on backend side — create plans, create tenant, uska plan 2–3 month
chalao, update karo, check karo process sahi chal raha, or pricing — or sath
business type jo abhi banai, or baki b flow wise."*

| Run | Trade | Stages | Cases | Result |
|---|---|---|---|---|
| R | billing (own plan + own shop) | 29 | 19 | 19 / 19, lived three times from a clean start |
| S | wholesale | 01, 02, 30 | 17 | 17 / 17 |
| — | mart | 01–09, 11–13 | 97 | 96 / 97 — F1 expects stage 10's 2,000 products; see below |
| — | food | 01, 02, 20, 21 | 26 | 26 / 26 |
| — | pharmacy | 01, 02, 22 | 16 | 16 / 16 |
| — | retail | 01, 02, 23 | 20 | 20 / 20 |

Stage B2 — "every entry in the menu opens its own screen, and nothing is
refused" — passed for all five trades on the regrouped sidebar.

### Found by stage R (and by `AShopPaysForThreeMonthsTest`, which turns the calendar)

| # | Case | What was wrong | Now |
|---|---|---|---|
| 121 | R5 | **A blank amount was booked as the plan's full price** — both forms say "leave the amount blank if nothing was taken / for a free assignment", and the server wrote a payment for the plan's price anyway | a ledger row only for money that was typed |
| 122 | R1 | **Three boxes on the Plans form saved nothing**: selling offline, its days, bills allowed over — dropped by the request rules, never returned by the resource; every plan's card read "Selling offline: No" | accepted, kept, shown |
| 123 | server | **Paying during grace moved the month and gave the late days away** — the renewal date crept later with every late payment | grace is part of the month that follows; only a shop that went read-only starts again today |
| 124 | server | **A month added to the 31st ran into the month after** (31 Jan → 3 Mar; 31 Aug → 1 Oct), and disagreed with the bills meter | added without overflow |
| 125 | R4 | The renewal dialog explained a rule and left the admin to work out the dates | "This buys 11 Nov 2026 → 11 Dec 2026", and why, before the save — from the method the save uses |
| 126 | R16 | **The owner was shown the plan's price as what it pays**, with an add-on on its bill | "You pay every month", plan + add-ons |
| 127 | R6 | On a phone the owner's payments showed date, plan and period — the AMOUNT was a sideways scroll away | two-line rows, amount first |
| 128 | R1 | "Days a till may sell offline" had no accessible name (two controls in one cell) | tied by hand |
| 129 | R2 | A plan's price reopened as "3000.00" | as typed |

### Found by living the trades again

| # | Where | What was wrong | Now |
|---|---|---|---|
| 130 | chemist's till (K7), under load | **A search that was turned away left the previous list on the till**, under the new word, with "20+ results · Enter to add" — the failure was only ever drawn over an EMPTY shelf | the tiles on screen must be the answer to what is in the box; otherwise "could not be loaded", Try again |
| 131 | owner, after a question about warehouses | **A one-shop business was shown Stock by place, Stock transfers, a Branch column and branch buttons** — drawn from what its plan ALLOWS (every plan allows a godown) | drawn from the places it HAS; the server sends the count with the settings; a one-place shop no longer fetches its branch list on every page |
| 132 | harness | **The journey met the API's own limit** (240 a minute per person): a full reload at every step is a dozen requests, and three trades ended on a 429 mid-stage | the kit waits for room before a case, and does not count the wait against the case |
| 133 | harness | C4 read the bill the instant a held ticket came back, before the server had priced it again (the promotion is not in the parked cart) | asked until it has settled |
| 134 | harness | A stage resumed after a failure rang stage G's sales before stage C's drawer was counted | a journey is lived in order, from the top |

Right first time: every bill figure across the quarter (plan, add-on, own
price, price rise, yearly ×12); grace and read-only on both sides; ceilings
moving with the plan; a distributor's carton, quantity break and credit limit
to the rupee; every trade's own day.

Mutations for the billing work: 28 run, 28 caught.

## The mart from the top, a clothing shop, a café — and the live box (2026-10-11, evening)

Carried on while nobody was at the keyboard: *"keep doing ur work and complete
everything."*

| Run | Trade | Stages | Cases | Result |
|---|---|---|---|---|
| — | mart, **from the top, in order** | 01–13 (stage 10 included) | 110 | 103 in the one sitting; the other 7 after two stale harness lines were put right. F1 closed: 2,006 products, 2 branches, 1 member of staff |
| T | clothing (retail) | 01, 02, 32 | 9 | 9 / 9 from a clean start |
| U | café (food, no floor) | 01, 02, 31 | 9 | 9 / 9 |
| — | offline shift (built preview) | — | 12 | 12 / 12 |

### Found by living a clothing shop's day

| # | Case | What was wrong | Now |
|---|---|---|---|
| 135 | T7 | **An exchange could not name a size.** The sheet offered "Lawn Kurta · Rs 2,500"; the server answered "this item is sold in sizes — say which size"; the sheet had nowhere to say it. The commonest thing a clothing shop does after a sale could not be done | each size is its own row, with how many are left; the size is sent |
| 136 | T7 | **The exchange added the money up itself, without the tax**: a Medium bought for 2,625 was a "credit (est.)" of 2,500, the Large "2,700", "collect 200" — and the sale wanted 210 and refused | the credit is the server's own sum (`returns/worth`), the replacement the till's own bill |
| 137 | T6 | The refund sheet named no figure before the press | "Goes back to the customer Rs 2,835 · incl. Rs 135 tax" |
| 138 | T6 | Two sizes of one design were two boxes with one name | each says its size |
| 139 | T1 | **Sizes came back alphabetical** — carded S, M, L, read L, M, S: on the till's sheet, the edit grid, the labels, the stock screen | they keep the order typed (`sort_order`); a new size added in an edit is where it was put |

### Found by living a café's day

| # | Case | What was wrong | Now |
|---|---|---|---|
| 140 | U7 | **An order rung "for here" at a counter never reached the kitchen.** A food shop with no floor is offered Dine-in at the till, with a table number to type; the rule that keeps a settled TAB from firing twice asked "is it a takeaway?" instead of "does it settle a tab?" — and a test asserted the empty board | sent to the pass like any counter order, headed by its table, on the slip too; only a sale that settles a tab is skipped |
| 141 | U8 | A note too small for the bill read "Change due Rs 0", in green, over a button that would not press | "Still to pay Rs 182.50" |
| 142 | server | `shopos:readiness` asked twice in one process carried the first answer's findings into the second | cleared each time |

### Harness

| # | Where | What | Now |
|---|---|---|---|
| 143 | every stage | **The laptop's Wi-Fi dropped and the till went offline** — rightly; the journey's second sale was kept on the device ("OFF-TILL-…") and every stage after it failed for the want of it | a case waits for the network before it starts, and says so if it never comes |
| 144 | D5 | Forty-five whole reloads in one case met the API's limit, now that the shop has a second branch | the walk waits for room every ten screens, as stage E's does |
| 145 | F2 | Asked for a sentence the module picker stopped using on 9 Oct; unseen because every run since had resumed with the switch already off | asks for what the line SAYS |
| 146 | F3 | Re-run after stage 13, it missed that stage's two sales | counted when the record says they were rung |

### The regression after it, and what that found

| Group | Result |
|---|---|
| desktop | 179 passed; 3 failed — offline shift (cannot run against the dev server; 12 / 12 on the built preview), a blank till on the run's first load (57 / 57 alone), and the one below |
| phone | 118 passed; 1 failed (an item not on the till once; 14 / 14 alone) |
| six trade projects · three restaurant layouts | 50 / 50 · 38 / 38 |
| retail (phones) journey · food journey | 20 / 20 · 26 / 26 — the returns and exchange sheets with serial numbers, and a settled tab not fired twice |

| # | Where | What was wrong | Now |
|---|---|---|---|
| 147 | header search | **Ctrl K, then Esc, left the palette open.** It heard Escape only inside its own box, and the box takes the focus 20 ms after it opens — so a key pressed at once, or after a click elsewhere, went to the page behind | Escape closes it from anywhere |
| 148 | harness | A mutated Blade view, restored by copy, kept its old timestamp — Laravel went on serving the compiled mutant, and the "after" run was red with identical sources | `view:clear` after a view is mutated |

Gates at the end: backend 3,647 tests (exit 0), panel 239 files / 2,655,
`npm run build` 0, `eslint .` 0 errors. Mutations: 11 / 11 (front door,
readiness, seeder), 20 / 20 (refund figure, size order, kitchen), 11 / 11
(exchange module, short tender, palette).

Right first time: a tag scanned twice is one line of two; a discount comes off
before the tax; the till will not sell a size with none on the rail; the
labels page prints a sticker per size; a takeaway's slips go to the right
station with the size and the extras and no prices.

### The live box

Read from outside — see `docs/decisions/shopos-live-check-oct11.md`. Works:
landing, sign-in, Try demo (a shop in 2.1 s), the API. Wrong, and the
server's to put right: no compression on JS/CSS/JSON (824 KB where 225 KB
would do), no cache headers, CORS `*`, `APP_NAME` still the old name. Wrong,
and fixed in code: `cartze.shop/` was the framework's welcome page.

## A shop that trades in dollars (2026-10-11, late night)

Asked for after the push: *"abhi currency type add kro — Pakistan main PKR, USA
main Dollar, India main INR — to wo select kr sky."*

| Run | Trade | Stages | Cases | Result |
|---|---|---|---|---|
| V | a grocer in dollars | 01, 02, 33 | 6 | 6 / 6 from a clean start |

What it found, before a line of it was lived: there was no control for a
currency at all (Help said to set one, on two pages); eleven places on the
server and sixty-two in the panel wrote "Rs" by hand; the browser's language
decided the commas; every drawer was counted in rupee notes. Decision and
detail: `docs/decisions/shopos-a-shop-trades-in-its-own-money.md`.

| # | Found while building it | Now |
|---|---|---|
| 149 | `formatMoney` was left with no caller but its own test once every screen used the shop's format — the reachability rule said so | retired; its cases live in `currency.test.ts` |
| 150 | Three older tests set a currency MARK by hand ("PKR", "AED", "د.إ") and expected it back | they choose a currency, and the mark follows |
| 151 | The Z-read printed a note count in the order the database keeps JSON keys ("1", "5", "10", "100", "0.25") | largest first |
| 152 | `/pos/sessions` answers `{sessions: […]}`; the new stage read it as a list | read as it is |

Asked on the same evening — *"lazmi ni branches warehouse main e stock rkhain…
hr branch ka apna stock udhe b pra ho skta"*: `EachBranchKeepsItsOwnStockTest`
(two shops, no warehouse) — 5 / 5 on its first run, nothing changed.

## A restaurant, from an empty shop — every page, every sheet (2026-10-12)

Asked for by the owner, who was testing by hand and finding what the suites had
not: *"aik complete flow bnao jis main hr page, hr module, hr modal sb kuch test
ho, kisi aik business type ko leke, real time data k sth … hr flow jo aik QA
human flow hai."* And: *"app slow to ni, queries optimize hain?"*

| Run | Trade | Stages | Cases | Result |
|---|---|---|---|---|
| W | a new restaurant | 01, 02, 20, 21, 40 | 26 + 10 | green, on the fourth restaurant — the first three each stopped on a fault below, or on the lid |
| Z | the same restaurant | 43 | 49 screens · 86 buttons · 27 sheets | 373 requests, the slowest 286 ms on a busy laptop; no layout fault, no refusal |

| # | Found | Now |
|---|---|---|
| 153 | The FIRST dish of a new restaurant was born stock-counted at nought — "none left" at every table. The item form sent its own default before the item types arrived | the form says nothing about counting until chosen or known; `AnItemIsCountedOrNotTest`, `e2e/food.first-dish.spec.ts` |
| 154 | …and the "Track stock" switch on an existing item flipped, saved, and changed nothing (never sent; the server prohibited it) | `ChangeStockTrackingAction`: it changes, with three refusals in words |
| 155 | Take order: every dish without sizes read "none left" and could not be pressed | `orders/whatIsLeft.ts` asks what the server asks |
| 156 | Take order: a dish in sizes went on with no size, at the Half's price; a dish with a question was refused on sending, with nowhere to answer it | the size-and-extras sheet; `VARIANT_REQUIRED` on the server |
| 157 | Take order printed "Approximately" over its own sum | `POST /orders/worth` |
| 158 | A phone or online order never reached the kitchen's pass | `SendAnOrderToTheKitchen`, when it is being prepared |
| 159 | "Cancel order" cancelled at one press, and told the customer "Cancelled by shop" | asks, with a reason that is sent |
| 160 | A cook's sign-in fired five refused requests on every screen (a till was booted for somebody who may not ring on one) | booted for `sales.manage` only |
| 161 | Every screen asked for the till's catalogue 2–3 times, and announced the device twice, to draw once | "reconnected" means a line that came back |
| 162 | The till logged "No queryFn" 48 times as it opened | both hooks share one function |
| 163 | The rate limiter was six queries on every request (13 for a list of suppliers) | counts in files where the cache is the database: 7 |
| 164 | The stock value report read the product table of EVERY shop to find this one's | summed first, named after, fenced to the shop |
| 165 | Budgets were read once a category; and a branch's own ceiling lost to the company's when the company's was written first | one read; the branch's own wins |
| 166 | The app's shell had no `<main>` — and one spec looked for words "in main", so it could not fail | the page is the main landmark |
| 167 | "Cancel this tab?" offered [Cancel] [Cancel tab] | the no says "Keep it" |
| 168 | "3 item(s)", "1 member(s)", "just now ago", "cod unpaid" | written as a person writes them |
| 169 | Currency and Dates on the Business tab told an office about "receipts, invoices" — my own wording, caught by stage Q | in `settingsWords`, where an office's wording is tested |

Stale specs corrected on the way (each agreed with a fault, or with a screen
that had since changed): H6 / J8 / J9 and `food.tab-order` read the Settle
sheet's old rows ("Tax (5%)", "2 item(s)"); Q8 looked for a sheet by the name
it had before it saved; three workshop checks expected a padded clock
("05:00"); two calendar specs asked the browser to name a day.

**Not verdicts:** a shut lid (15:08–15:20) cut the six-trades group and one
restaurant run — `net::ERR_NETWORK_IO_SUSPENDED` in the trace. Run again, green.

**For the owner to decide** (`docs/decisions/shopos-an-order-reaches-the-kitchen.md`):
an order is not taxed and takes no offer; raw ingredients are offered for sale;
"Reservations" in a restaurant is item holds, not tables.

## One press to the kitchen, two tabs, and an order page that holds still (2026-10-12, night)

The owner, looking at the screens built that afternoon: *"take order ka process
flow kya hai — order lia, kitchen ticket? send to kitchen? print for kitchen?"*,
*"new take order ka UI abhi b acha ni hai — POS ki screen dekhlo — cheezaion bht
zyeda scroll main ja rhi"*, and *"make tab — Today and Past orders, past orders
in table form"*.

| # | Found | Now |
|---|---|---|
| 170 | A restaurant's own phone order needed three presses — taken, Confirm, Start preparing — before a cook heard of it | **Send to the kitchen now**, ticked where there is a kitchen: taken and being prepared in one press |
| 171 | An order reached the kitchen's *screen* and never its printer: the server made the ticket and no screen was told which | the answer names the ticket; the screen that sent it prints the slip, and says if it could not |
| 172 | The order sat under the menu and sank with every "Show more"; then in a tall panel that scrolled the customer away | laid out like the till — the page does not scroll, the panes do; total and button along the bottom |
| 173 | One list held today's queue and last month's orders, newest first | **Today** (a board of what is being worked + "Finished today") and **Past orders** (a table) |
| 174 | "Today" would have ended at midnight, in the middle of a restaurant's evening | `when=today|past` is cut by the shop's day, on the server |
| 175 | The orders table ran off a phone's right edge — and what was off the edge was the total and the stage | below `sm` a row is two columns of the same cells |
| 176 | The board's "Nothing is waiting" would have been said over a request that failed — caught by the standing guard before it was ever run | `<ListEmpty from>`: refused, failed, or empty |
| 177 | The new spec waited for "a ninth button in the menu" — which the section chips and the bar already were — and measured the page while the menu was still arriving (a dish "under the install card" on a tablet) | it counts dishes, waits for more, and lets the page come to rest |

**The pre-push regression** (real tree, after everything was landed):

| Group | Result |
|---|---|
| restaurant · tablet · phone | 48 passed |
| desktop | 177 passed, 15 failed → **27 of 27 passed alone** |
| six trades | 47 passed, 3 failed → **12 of 12 passed alone** |
| admin | 44 passed, 1 failed → **passed alone** |
| storefront · doors | 41 passed |
| phone | 128 passed, 1 failed → **14 of 14 passed alone** |
| a new restaurant — stages 01 02 20 21 40 43 | 38 passed |
| finance (28) · pharmacy (01 02 22) · mart (01–13) | 13 · 16 · 110 passed |
| after the orders screens changed: `food.take-order` ×3 sizes · the screen walker · sheets · online (01 02 27) · at volume | 16 · 17 · 22 · 14 of 15 · 3 passed |

**Not verdicts.** The 20 failures fell between 20:03 and 20:40. One (a 300 s
timeout on a phone) sat inside a shut lid, 20:34–20:40. For the other 19 —
fifteen tills that rang their sales *offline*, three serial-number checks, one
admin screen — the server's log has no error in those minutes, and every one
passes run alone with one worker. In those minutes the copy stack was running
331 backend tests, a type check and screenshot scripts on the same laptop:
likely, not proven. The online journey's A6 ("the Audit Log says who created
it") failed while the mart journey's volume stage was filling the same log;
stage 01 run alone afterwards: 6 of 6.

**Gates on the real tree, after all of it:** backend 3,745 tests (3,723 passed,
22 skipped); panel 251 files · 3,017 tests; `npm run build` exit 0; eslint 0
errors; both type checks clean.

**For the owner to decide** — unchanged: an order is not taxed and takes no
offer; raw ingredients are offered for sale; "Reservations" in a restaurant is
item holds, not tables.

## A badge, a question, a count that is kept — and the front page read down (2026-10-13, small hours)

The owner, on seeing the Orders screens: *"pickup and delivery badge on orders
page or any identifier?"*, *"when out for delivery, ask assign rider — optional,
but ask always"*, *"on sidebar orders count? … blinking dot like notification"*.
Then, on being told what the count cost: *"aise to theek nahi, har baar load ho
— tab update ho jab order create ho"*. Then the landing page: *"hero pe blue
background … apne primary color se"*, *"Nine trades … jo mobile khud bana rahe
wo acha ni lga"*, *"salon ni, services hain"*, *"ek symmetry chahiye"*, *"real
plans … jo jo offer kar rahe wo bhi list"*, *"dashboard ka screenshot, full
menu ke saath"*.

| # | Found | Now |
|---|---|---|
| 178 | Delivery or pickup was two grey words at the foot of a card, and a column only a wide screen drew | a badge — blue *Delivery*, purple *Pickup* — on the board, in the table at every width, on the sheet |
| 179 | "Out for delivery" sent an order out with nobody on it and never asked | it asks who is carrying it, always; *Send without a rider* is always there, and a shop with no rider is told where riders are made and not stopped |
| 180 | A new order arrived in a list on a screen nobody was looking at | the menu's Orders row carries how many are being worked; a new one turns it orange with a blinking ring |
| 181 | The rider sheet's two buttons side by side pushed the first off a phone | one above the other below `sm` |
| 182 | **The count was asked on every load and every half minute** — and a walk of 35 screens a minute was refused by the API's limit because of it (301 requests in 56 s, 32 of them the count) | kept on the device; asked again only on news of an order — this device's own work, the bell, the Orders screen's own list — and otherwise once in two minutes |
| 183 | The walk of every menu entry asks 269 things in under a minute even without the count: over the 240 a person is allowed. It had been passing on where the limiter's minute turned | it makes room every eighth screen; the take-order spec (fifteen tests, one owner) makes room before each |
| 184 | A check of "how many times was the count asked" counted the dev server serving two source files named `orders/waiting…` | it counts requests to the server's own address |
| 185 | The same check waited for "the next answer from the bell" and then counted the asking that answer caused | it waits on what the device has heard |
| 186 | The front page's dark bands stood under an indigo light — the colour of a brand the product no longer has | the brand's own ground and light, read from the ramp; the footer on the same ground |
| 187 | Two headings hung off the left edge above three equal columns, between sections whose headings were centred; the three steps were left-hung under a centred heading | one form: centred over a full-width row, left beside a picture |
| 188 | Nine trades were pills that wrapped seven and two, over a list floating beside a narrower card | nine equal tiles (three by three on a phone) over one card of two halves |
| 189 | The trade's till was a drawing with three invented lines on it | a photograph of a real shop of that trade, nine of them; a finance office is shown its books, not a till it does not have |
| 190 | "Salon & services" — the trade is Services | Services, on the tile, the footer, the enquiry form and the demo chooser |
| 191 | The page sold three plans at 2,500 / 6,000 / 15,000 with hand-written points ("Up to 2 tills" on a plan that allows one). The product has four, at other prices | the seeder's four, every line written from the figures; what Basic lacks (selling offline) is said and marked; a test reads the seeder |
| 192 | The hero said eight trades over a section that says nine | nine |
| 193 | The dashboard was photographed at two in the morning: "Good morning, Tuesday" over a "Today" that was Monday's (the day turns at five) | the script can set the hour the page reads; the picture is the evening of the shop's own day |
| 194 | **Mine.** Moving that night's expenses onto the shop's day by their *description*, an older expense of the same name went with them | put back on its own day (worked out from the old picture: 1,800 + 2,450 = the 4,250 it showed). Found by id from now on |

**On the copy stack before landing:** `waitingCount.test` 13,
`useOrdersWaiting.test` 11, `plans.test` 8; faults put in — nine under the
count's unit tests, three under its browser test, four under the plans' —
all caught, and each restored run green.

**Gates on the real tree, after all of it:** backend 3,748 tests (3,726
passed, 22 skipped); panel 256 files · 3,063 tests; `npm run build` exit 0;
eslint 0 errors; both type checks clean.

**In a browser, on the real stack, after the last change:**

| Run | Result |
|---|---|
| `food.take-order` × three sizes | 17 passed (6 skipped by design: one order through its life is run on one size) |
| the online journey — stages 01 02 27 | 15 passed |

**Run that night against the FIRST build of these screens, and not again
after the count became a kept one:** the screen walker 17, the sheets 22, at
volume 3 — all passed. The change since then is in when a request is made,
not in anything drawn. The whole standing regression was not run again
before this push; the owner stopped the night's work and asked for what was
done to be pushed.

**Not run at all:** the landing page has no browser spec. It was photographed
— every section, at a laptop's width, a tablet's and a phone's — and no
width scrolls sideways.


