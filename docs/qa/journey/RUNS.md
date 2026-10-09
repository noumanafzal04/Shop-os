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

Next: finance (when the owner asks for it).
