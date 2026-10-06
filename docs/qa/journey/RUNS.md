# The journey — runs

One row per run. A "product bug" is something a shop would have met; a
"harness fault" is the test being wrong, and is listed so nobody reads a red
run as the product's fault twice.

| Date | Trade | Shop | Stages | Cases | Result |
|---|---|---|---|---|---|
| 2026-10-05 → 06 | mart | QA Mart 1005-231446 | 01–12 (A–G) | 105 — stages 01–09: 55 · 10: 13 · 11: 7 · 12: 30 | every stage green on its last run |

Not yet run: a FRESH mart journey from stage 01 on a new shop (stages 10–12
were built against the shop stages 01–09 made), and the other eight trades.

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
