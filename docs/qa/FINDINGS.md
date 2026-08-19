# QA sweep — findings

Newest first. Each row is reproducible from the call recorded beside it.

**Three levels.** `BUG` is a defect. `QUERY` is behaviour that differed from the
sweep's expectation and needs a human decision — **about half of these turn out
to be correct behaviour nobody had written down**, and finding those is worth as
much as finding a defect. `HARNESS` is the sweep itself being wrong, kept
because a harness bug that looks like a product bug is the most expensive kind.

---

## 2026-08-19 — the screens, for the first time

**A shop reported seven defects by holding a tablet. Not one was caught by 3,079
green tests.** This is what was built about that, and what it found.

### The gap was the tool, not the tests

Everything under `src/**.test.ts` runs in **jsdom, which has no layout engine**:
`getBoundingClientRect()` returns zeros, no stylesheet is applied, and no media
query ever matches. A close button under a header, a 28px tap target, a modal
taller than the screen, content behind the sidebar — **none of those are wrong
in the source.** They are wrong only once something computes a position.

So: Playwright, real Chromium and real **WebKit** (the engine an iPad runs, and
the one that taught this codebase `100dvh` never `100vh`), at three viewports.
Five rules, each generalised from a defect that actually happened:

| Rule | The defect it generalises |
|---|---|
| Nothing a finger must press is covered | the close button under the header |
| Every tap target is ≥ 32px | that button at 28 |
| The page does not scroll sideways | the till header hiding Drawer and Close |
| What is open fits the screen | the payment panel taller than the tablet |
| The page ends above what is pinned to it | the PWA card sitting on the page |

### What it found

**The PWA install card sits on the page.** `fixed bottom-3`, `z-[999998]`, over
whatever the screen drew down there. On the shop setup page that was the
**"Finish setup" button** — the primary action of the first screen a new shop
ever sees, at exactly the moment that banner appears. On the Help Centre it was
the last paragraph of every article.

Fixed by having the card measure itself into `--pinned-bottom` and each
full-height page reserve that room. Measured, not hard-coded: the card is two
lines on Chrome and four on Safari, whose copy explains Share → Add to Home
Screen.

**Two till controls below the floor**: the scan-sound mute at **24×24** and the
sync pill at **72×28**. The first is what a cashier reaches for in a noisy shop
without looking; the second is the one they jab when the line drops.

### Four ways the suite fooled itself first

Every one is the failure this sweep keeps finding, now inside the tool built to
find it.

**It tested the shop setup form fourteen times.** Sign-in asserted the URL
matched `/tenant` — and `/tenant/setup` matches `/tenant`. The sweep's tenants
have never completed setup, because the API does not gate on it and only the
panel does, so every route redirected there. Fourteen screens reported as
dashboard, catalog, reports and till were one unchanging form, and **everything
passed.** Caught only by the denominator: the till measured **1 tap target where
it has fifty**.

**The covering rule went green against the defect it was written for.** Its
first version asked "is this covered right now"; scrolling brings the control
out from under the card, so it passed. The question a shop has is "can I press
it at all" — so it scrolls each suspect to the middle and asks again, and a
separate rule asks whether the page ENDS above what is pinned, which is the part
that cannot be scrolled away.

**It measured boxes nobody can see.** `getBoundingClientRect()` reports the full
box even when an `overflow: auto` ancestor clipped most of it away. The Help
Centre's last paragraph ran to y=729 while its scroller cut it at y=700 —
reported as overlapping a card at y=712 that no reader could see it behind.

**One rule disturbed the next.** `nothingIsCovered` scrolls, including sideways,
so the sideways-scroll rule fired once and never again. A finding nobody can
reproduce teaches the reader to ignore findings.

---

## 2026-08-19 — tenth run · phases O and P, and the day nobody had ever driven

**Two new phases. One product bug, and it is money.**

### Phase O — the two tickets that are not a sale

A parked basket and a phone order are both a claim on stock nobody has paid
for, and they are dangerous in **opposite** directions:

- **A parked ticket holds nothing.** It is a note under the till. If parking one
  moved stock, a shop that parks ten tickets across a Saturday would spend the
  day refusing to sell goods it has, and nothing would ever error.
- **A phone order holds everything.** Two orders for the last packet is a
  customer standing at a door for nothing, so the hold is taken the moment the
  order is, and given back on cancel **exactly once**.

Plus the one that costs real goods: **`claim` is atomic.** A ticket belongs to
the site, so any lane can finish it — and two cashiers who open the held list in
the same second would otherwise both load the same basket and both take money
for it. One basket, two bills, stock off the shelf twice.

All green. 241 checks, three new mutations, all caught.

### Phase P — the day

A shift is one person's drawer. A **day** is the shop's, and it is the unit the
books are actually kept in. Nothing had ever driven it from outside.

**THE BUG: money banked today was recorded against yesterday.**

"Which day is this counter trading?" was asked in three places and answered
three ways — `open()` by branch + today's date, the screen by
`latest('trading_date')`, and the deposit **with no ordering at all**. With one
open day nobody could tell. With two — the ordinary state of a shop that shut
late — the deposit took the older one.

The shop walks the takings to the bank, today's banking column never moves, and
yesterday's day is eventually closed off carrying money that was never in it.

Fixed with one resolver, `BusinessDay::openFor()`, used by both. Full argument
in [`docs/decisions/shopos-which-day-is-open.md`](../decisions/shopos-which-day-is-open.md).

### The test that passed against the bug

The first regression test **went green on the broken code.** An unordered
`->value('id')` returns rows in insertion order, and the test built today's day
first, so the broken query found the right row by luck.

The fix was to build the rows in the order reality builds them: **yesterday's
day exists first, because yesterday came first.**

### Three harness lessons, all from phase P

**Closing a day is irreversible.** It is keyed on branch + date with no re-open
path. The first version shut the real trading day on all eight shops and every
phase from C onward went red at once — *"Trading on 2026-08-19 has already been
closed off"* — for the rest of the day. Correct product behaviour, unrecoverable
harness. A day belongs to a branch, so the phase now trades on one nobody else
touches and takes the next one when today's is spent.

**The destructive check must not gate the harmless one.** Banking closes nothing
and belongs on the counter the shop actually trades from. It was ordered *after*
the private branch, so when the plan's branch ceiling bit — correctly, at 4 —
the check that found the defect was the one that silently stopped running.

**`/pos/session` answers 200 whether the drawer is open or shut.** Reading "did
the call return a body" instead of `status == "open"` meant the open-drawer
check closed days that had no open drawer and reported the refusal it never got
as a product bug, on three shops out of seven.

### Where it stands

**16 phases · 1,554 checks · 23 mutations · 47 harness findings, 4 product bugs.**

---

## 2026-08-19 — ninth run · the phases stop choosing their own shops

**927 → 1303 checks. 17 → 18 mutations. One product bug, and it was hiding
behind a harness that had never asked the question.**

### What was wrong with the sweep

Phases K, M and N picked which shops to run on from a **hardcoded list of
trades** — `("mart", "retail")`, `("retail", "automotive", "mart")` — sitting
right beside a `features` check that already knew the answer. Two copies of one
fact, and they had drifted: pharmacy, automotive and petroleum all have branches
nobody had ever moved stock between; five trades' loyalty and coupons had never
been looked at.

The gate is now the module and only the module. Phase L needed no change — it
had always asked `features.dine_in`, which is why it was right.

Phase I was narrowed on purpose, with a reason that had expired: *"seven logins
against a 5/min limit to learn the same fact once."* The token cache killed that
cost months ago, and the claim was only half true — the preset list is built per
TRADE, so a workshop's and a salon's had never once been looked at.

### The bug that fell out

**A restaurant was offered a Purchasing job it could not do.**

`buyer` — *"Deals with suppliers, raises purchase orders and records what was
paid against them"* — was offered on `inventory` **OR** `products`. A restaurant
keeps a menu (`products`) and holds no stock (`inventory`), so it was shown the
job. Every screen in that description sits behind `feature:inventory`; the route
file says so in as many words: *"part of the stock chain, so it rides the
inventory module."* An owner could hire someone into Purchasing and that person
could open nothing — suppliers, purchase orders and payables all answer
MODULE_DISABLED.

The module gate was never wrong. **The list was wrong about which jobs this shop
has.** `'modules' => ['inventory']`, with two tests: a kitchen is not offered
one, and the five trades that hold stock still are. Red on revert.

`stock_keeper` keeps both modules and correctly so — half of what it describes
is keeping the catalog straight, which is real work in a kitchen that counts no
stock. The sweep now says that out loud rather than inferring it.

### The harness bug underneath it

The first widened run reported **eleven bugs**, and every one of them was wrong.

The check read *any* 403 on a job's own screen as "this preset did not grant the
permission it promised". But **two different refusals wear the same number**:
the shop's OWNER gets the identical 403 on `/suppliers` in a restaurant, because
the module is not there. A `MODULE_DISABLED` answer says nothing whatsoever
about permissions.

So the check now separates them, and the module 403 — which used to be noise —
became the sharper question: *a job every one of whose named screens is switched
off is a job that should not have been offered.* That is the rule that found the
buyer bug, and it only exists because the false accusation was chased instead of
silenced.

Naming the routes mattered too. A first version asked whether **all** of a job's
reachable routes were off, and found nothing: `buyer` can still open `/products`
because `PRODUCTS_MANAGE` rides along in its permission list. The rule had to be
about the routes the job's **description** names (`core`), not everything its
permissions happen to touch.

### The denominator

`Report.summary()` now prints which shops each phase actually spoke about,
derived from the rows themselves so a phase cannot forget to declare, and
compared against the shops whose modules say it should have run.

This is the guard for the failure that made the whole run worth re-examining:
phase M could not build a sellable line for a services shop — a salon may sell
only `service`, and the harness posted `physical_product` at every trade alike —
so it gave up, and **for the entire life of this sweep nobody ever checked a
salon's points or coupons.** The run still printed a clean green summary,
because checks that did not happen do not appear in a list of checks that did.

Narrowing phase K back to mart+retail on purpose now prints:

```
  K    2  mart, retail   ·  SILENT ON: automotive, food_restaurant, petroleum, pharmacy
```

### Where the coverage stands

```
  B C D E F H I J M N   8-9 shops each — every trade with the module
  G                     5 — trade-specific by design (FEFO, recipes, serials, forecourt)
  K                     6 — every shop with `inventory`
  L                     2 — every shop with `dine_in`
```

**Still true and still the biggest gap:** the sweep drives HTTP only. Every one
of the tablet defects the shop found by holding the device was invisible to all
3,078 tests.

---

## 2026-08-18 — eighth run · phase N, and a dead-endpoint sweep

**All fourteen phases in one run: 927 checks, 0 bugs, 0 queries.**

### The API surface is fully wired

`scripts/dead-endpoints.py` reads both clients (panel and mobile) and asks three
questions — a route with no caller, a call with no route, a call with the wrong
verb:

```
1 of 295 api/v1 routes have no caller in any client
360 call sites read · 360 agree with a route · 0 hit nothing · 0 wrong verb
```

The one hit is `GET /admin/staff/{staff}`, and it is **surplus rather than
missing**: it returns `UserResource`, which is exactly what the list already
returns — including `permissions`, which is the only field the edit form needs.
The panel edits staff from the list, so nothing ever needs to fetch one. Not a
defect; recorded so the next person does not chase it.

### Phase N · the sales that are not a sale yet — clean

Everything in phases C–M rang a bill and took the money in one movement. These
are the shapes where those two moments come apart, and each is a place a shop
loses goods or banks money twice.

| | |
|---|---|
| **A layaway holds money, not revenue** | The advance reached the drawer (**+400**) and moved revenue by **zero**. Both halves matter and getting either one alone is the bug: cash not in the drawer means the shift closes over by exactly the advance, every time; revenue booked early overstates the month and is then counted again on collection. |
| **Collection books the whole sale** | +1000 at the moment the goods leave, and a second collection is refused (**409**). |
| **An exchange does both halves** | One returned, one taken — shelf ends exactly where it started. Checked on the SHELF, because that is the half a receipt cannot lie about. |
| **A trade-in is a tender, not a discount** | A 500 item with 150 taken in part-exchange is still booked at **500**. As a discount it would understate what the shop sold, for ever, on every report. |
| **`trade_in` is not a payment method** | 422. A client that could name its own trade-in figure could settle any bill with nothing changing hands. |
| **The bin and the claim stay apart** | Written-off absent from the awaiting-credit list, returned-to-supplier present, and a credited claim leaves it. Summing the two tells an owner they lost money they are actually **owed** — and nobody chases a figure already written off. |
| **Disposing takes the stock off once** | A lot of 4 disposed moves the shelf by 4, not 8. |

### HARNESS · five more, and one of them was contagious

| What | Detail |
|---|---|
| **Phase N left a drawer open** | Phase C on the NEXT run inherited it, opened its shift expecting a fresh float, and found this phase's takings still in it — reported as **phase C failing its own drawer arithmetic**, three phases from the cause. A phase must close what it opens. |
| A layaway takes its deposit at **creation** | "This shop asks for at least 20% down." Opening one with nothing on it would be a promise with no commitment behind it — goods held off the shelf for a customer who has risked nothing. |
| Returning goods names the **supplier** | Required, and rightly: a claim against nobody is not a claim, and the awaiting-credit list is a list of who owes you. |
| Crediting takes `credit_received` **and the date** | Not an "amount". A claim is settled by what the distributor actually paid and when, which is what makes it reconcilable against a bank line months later. |
| **A stale log looked like a fresh green run** | `run.py` and `mutate.py` import their phases by bare name, so launching them from anywhere but the sweep directory fails — and inside a background job the shell had already redirected output, leaving the PREVIOUS run's summary sitting there looking like this one's. It read "891 ok, 0 bugs" for a run that never happened. **A green summary that was never produced is worse than a crash.** Both scripts now `chdir` to their own directory. |
| The disposals register has no totals block | It is a plain list, and the separation lives in the `awaiting_credit` filter — the screen a shop actually works from. The sweep looked for a totals block and reported its absence; the right question was the filter. |

> Running total: **42 harness findings, 2 product bugs.**

---

## 2026-08-18 — seventh run · phases L and M

Two phases for the two things a shop does that are neither selling nor
stocking: **serving a table**, and **giving money away on purpose**.

**All thirteen phases in one run: 891 checks, 0 bugs, 0 queries. 15 of 15
mutations caught.**

### Phase L · the floor — clean

A restaurant's till is the LAST thing to hear what happened. Food is ordered at
a table, cooked in a kitchen that never sees a price, and paid for at the end —
sometimes by four people who each want their own bill.

| | |
|---|---|
| **The tab is the unit** | Two rounds an hour apart both land on it; 5 covers priced by the server at 1750. |
| **A settled table is free again** | Otherwise the floor fills with tables nobody is sitting at. |
| **The pass sees food, not money** | The KOT carries the dish and *"no chilli"* — and **no prices at all**. A kitchen screen showing the bill is how a kitchen hand ends up knowing the shop's takings. |
| **A split takes a part** | Two of five paid, **three still owing**, tab still open. Closing the whole thing is how a table walks out having paid for one plate of five. |
| **The carve conserves** | A partial settle divides the line — a paid row stamped with the sale, the original left holding the remainder. `2 paid + 3 owing = 5`, to the plate. |
| **A table belongs to its waiter** | Another waiter settling it: **403**. The cashier settling it: allowed. Those two facts are one permission apart (`tables.serve_any`) and getting either wrong breaks the other person's job. |

### Phase M · the money given away on purpose — clean

Points, coupons and promotions are one thing wearing three hats. They fail the
same two ways: **given twice**, or **not given at all**.

| | |
|---|---|
| **Points earn at the shop's rate** | 25 on a 2500 bill, at 1 per Rs 100. |
| **And are worth what the shop says** | 10 points → exactly Rs 10 off. `redeem_points` is a **count**, never an amount — the server multiplies by its own `loyalty_redeem_value`. |
| **Redeeming spends them, and earns on the net** | 25 − 10 spent + 4 earned on the 490 actually paid = 19. |
| **They cannot be overspent** | `INSUFFICIENT_POINTS`. |
| **A refund takes them back** | The whole sale returned, all 19 reversed. Points are money the shop owes; earning them on goods that came back means paying for a return twice. |
| **The counter is quoted the real value** | `/coupons/validate` needs the **subtotal**, and must — a `min_spend` cannot be judged without knowing the basket. |
| **The server prices the coupon** | 10% of 1000 = exactly 100. |
| **A one-use coupon is used once** | `COUPON_EXHAUSTED`. A code shared on WhatsApp reaches a thousand people; this counter is the only thing between that and a thousand discounts. |
| **The preview agrees with the bill** | 200 quoted, 200 charged. Two different numbers there is worse than no preview — the cashier quotes one and the customer is charged the other, at the counter, in front of them. |
| **A discount needs the permission to give it** | Whole-bill **and** per-line, both 403 without `discounts.apply`, both allowed with it. Checked in both places because the bug was that only one was fenced: a cashier with plain `sales.manage` could once key Rs 5,000 off a Rs 5,200 bill. |

> `discount` is **not** like `unit_price`. A cashier keying "Rs 200 off" is a
> real thing shops do, so the field is accepted — and fenced by a permission
> instead. The sweep's first version treated it as an attack and reported the
> shop's own feature as a hole.

### HARNESS · the dangerous one

| What | Detail |
|---|---|
| **A permission probe ran as the wrong identity** | A staff sign-in that failed on the login throttle returned `None`, and the client fell back to the **ambient** token — so the probe ran as the admin and got a **401**, which the check read as the 403 it was hoping for. **A refusal that proves nothing, printed as a pass.** Fixed with an explicit `NOBODY` sentinel, and a 401 in any permission probe is now reported, never counted. |
| Phase M's promotion re-priced phase C | A 20% promotion scheduled against the sweep's shared product made the server-pricing check charge 800 instead of 1000 **on the next run** — a phase quietly discounting another phase's subject, surfacing three phases from the cause. Each phase now rings its own item. |
| The loyalty checks were stacking with that promotion | "10 points discounted 110" — points looking worth eleven times what the shop set. A phase that measures a discount has to ring something nothing else is discounting. |
| The one-use coupon only ever took the "already spent" branch | Same weakness the serials had: a fixed code is spent on run one, and the first-use half stops being exercised while the sweep still prints a pass. Fresh code each run. |
| Four checks shared one dining table | Each reused the previous one's open tab — six covers instead of five, and a 2,100 bill being tendered 350 against. Both read as product bugs and were the sweep piling its own plates up. |
| `running_total`, `data.kots`, `sale_id` on a carved line | Three more shapes. A tab is not a sale until it is paid, and the field names say so. |

> Running total: **37 harness findings, 2 product bugs.**

---

## 2026-08-18 — sixth run · phases I, J, K added

Three phases aimed at what the first eight had never asked: **who** is standing
at the counter, **which lane** they are on, **which branch** they are in, and
where the shop's money goes when it is not a sale.

**All eleven phases in one run: 839 checks, 0 bugs, 0 queries. 13 of 13
mutations caught.**

---

### 🐛 BUG · the stock correction that landed at the wrong shop

An owner running two branches switches to the second one and corrects a figure —
a breakage, a recount, a write-off. **It lands on Main's shelf.** Two shelves
wrong from one correct action; nothing errors; the screen they were reading was
showing the second branch the whole time.

`InventoryService::adjust` took the branch from the request **body**, and
`AdjustStockRequest` has no `branch_id` rule — so it was always Main. The panel
sends `X-Branch-Id` on every request.

What makes it unambiguous: **four paths write to that shelf and three of them
already ask where you are** — receiving a lot, posting a stocktake, and the sale
path, two of which say so in comments. Only the hand adjustment, the one a shop
reaches for most often, did not.

**Fixed**, three regression tests added (reverting turns two red), full suite
**2074 passing**. Written up in
[`shopos-adjust-wrong-branch.md`](../decisions/shopos-adjust-wrong-branch.md).

> `BranchOperatingContextTest` already existed, with exactly the right name and
> fixtures — and all four of its tests were about the SALE path, which was
> correct. The adjustment endpoint was never called. **A test class can have the
> right subject and still never ask the question.**

How it surfaced: Phase K set 60 at Main and 25 at the second branch, then read
back **25 and 0**. Not a crash — two numbers that could only have come from one
shelf.

---

### Phase I · who is at the counter — clean

Every phase before this ran as the **owner**, who passes every gate there is.
That made eight phases of green worth less than they looked.

**The jobs.** Each shipped preset hired as a real staff member, signed in, and
asked from both ends — what its own description promises, and what belongs to
somebody else:

| | |
|---|---|
| **A cashier cannot void or refund** | 403 on both. Ringing is the job; reversing it is a supervisor's. |
| **The kitchen reaches the pass without the till** | `kitchen.manage` alone opens the board, and the sales ledger, the takings and the drawer all stay shut. This is the codebase's named bug — a kitchen hand once had to be shown the shop's takings to mark a curry ready — checked from outside. |
| **The stock keeper keys data and touches no money** | Catalog, movements and counts open; reports, expenses and the till closed. |
| **Accounts cannot sell or move stock** | 403 on both writes. |
| **A manager runs the shop but does not staff it** | `/staff` closed; everything else open. |

**The lanes.** Three cashiers, three registers, one shop, at once — with
deliberately **different** floats and basket counts, because equal figures would
let a drawer read its neighbour's takings and still balance:

```
Lane 1 @1000 rang 500   → drawer 1500
Lane 2 @2000 rang 1000  → drawer 3000
Lane 3 @3000 rang 1500  → drawer 4500
```

Each X-read returned its **own** session; one cashier could not read another's
Z-report; every lane closed level.

### Phase J · the Expense Manager and its wire to the till — clean

Phase E proved an expense reaches the books. This is the harder half: a shop's
money moves through the ledger **and** the physical drawer, and an entry that
lands in one and not the other produces a cashier who is short at ten at night
with nothing to point at.

| | |
|---|---|
| **A cash bill takes the cash with it** | `expense_out` on the shift, drawer −3500, and the expense carries its `cash_movement_id` — without that link the entry and the till can drift apart for ever. |
| **A transfer does not** | Rent paid by bank left the drawer untouched. The inverse error is just as expensive: a drawer docked for money that was never in it. |
| **Cash income lands in it** | `income_in`, drawer +900. Without this the drawer reads it as an overage. |
| **A separate purchase leaves it too** | Paying a supplier at the door — nothing to do with the Expenses screen — still writes `supplier_out` and takes the drawer down 2500. |
| **Buying stock is not an operating expense** | Receiving a purchase order moved `totals.expenses` by **zero**. It is COGS, and posting it twice would make every margin wrong in the direction that looks safe. |
| **A ceiling warns, it does not refuse** | Over budget: recorded, and said out loud. Refusing does not unspend the money — it only means the books stop matching the world. |
| **A template posts, moves on, and will not post twice** | Due date rolled a month; a second post refused. |
| **The drawer equals its own parts** | `opening + tendered − change − refunds + tips + in − out = expected_cash`, checked against the drawer's own published components. |
| **`pos_require_shift` actually refuses** | `SHIFT_REQUIRED` with it on, selling restored with it off. This setting is the fence: cash from a shift-less sale is real and in the drawer, and the drawer never hears about it. |

### Phase K · more than one shop under one roof — clean (after the fix)

| | |
|---|---|
| **Stock is per branch** | Main 60, second 25 — separately set, separately read. |
| **Both shelves are visible** | Cross-branch lookup names each. "Do you have it at the other branch?" is the most-asked question on a two-shop counter. |
| **A transfer moves and conserves** | Main −10, second +10, and **85 either side**. Checking only the destination is how a transfer that never depletes the source ships: the goods appear at one shop and stay at the other. |
| **A branch cannot send what it does not hold** | 422, and the refused transfer moved nothing. |
| **HQ is the sum of its branches** | 50 + 35 = 85, all-branches view against each focused one. |
| **Staff cannot wander** | A cashier assigned to the second branch, sending `X-Branch-Id` naming Main, still sold out of **their own** branch. Observed by which shelf went down — the only way that cannot be faked. |

### HARNESS · six more

| What | Detail |
|---|---|
| **Plan limits are real: staff 5, registers 2, branches 1** | The sweep needed more and quietly failed. Turned into a check instead of a workaround — **watch it refuse, raise it, watch it allow** — because a limit never observed refusing anything is indistinguishable from one that does not work. |
| A ceiling cannot be set **below current usage** | `LIMIT_BELOW_USAGE`. Correct: a limit that strands existing rows is a trap, not a limit. The sweep ignored that 422 and reported the resulting create as a bug. |
| A manager **may** read the lane list | `SUPERVISES_TILLS` is `settings.manage,reports.view` — either will do, and the lane list is the header of every shift report. My expectation was wrong, not the gate. |
| `opening_float` is on the **session**, not the drawer | The identity then failed by exactly the float — which looks like a missing five thousand rupees and is a missing key. |
| `/reports/valuation` returns `{branch_scope, totals, by_category, items}` | The envelope, for the third time in this sweep. |
| The recurring template had already posted | "Isn't due until Sep 18" — the feature working, and a sweep that can only exercise it once stops testing it after the first day. |

| **The sweep was reading the rollup, not the shelf** | `products.stock_quantity` is the sum across every branch. The sweep read it for eleven phases and was right every time — because there was only one branch. The moment phase K opened a second, writes went to Main and reads came back as Main + second: `SET MEANS SET — asked for 42, shelf says 76`. It also stopped restocking, because a rollup of 85 looks healthy while the shelf being sold from is at −1. **A number that was right for eleven phases and wrong for the twelfth was never right — it was under-determined.** Now in [`shelf.py`](sweep/shelf.py), read once, used by every phase. |

| The moving cost is weighted by the **rollup**, the shelf by the **branch** | The mirror of the row above, found in the same run: `products.cost` is per product, so receiving at a new price blends against everything the shop holds anywhere. Using Main's shelf as the denominator gave a cost wrong by a few rupees — the hardest kind of wrong to notice. |
| Phase I's lanes rang into an empty shelf | Six baskets across three lanes, after eight earlier phases had sold, returned, counted and transferred through the stock. Reported as a lane bug; it was the sweep's own housekeeping. |

> Running total: **30 harness findings, 2 product bugs.**

---

## 2026-08-18 — fifth run · phases A–H complete

**427 checks across all eight phases.** One product defect, and it is a bad one.

---

### 🐛 BUG · the forecourt nobody could start

A petrol pump that set up its forecourt **through the panel** could never open a
forecourt shift. It was told:

> Set up at least one tank and one nozzle before running a forecourt shift.

— immediately after doing exactly that, with no way out of the loop. The whole
fuel module was unreachable for any station that used the shipped screen.

Two halves answered the same question in opposite directions. Opening a shift
resolved a missing branch to Main; creating a tank stored the null the panel
sends. `where('branch_id', $branchId)` then matched nothing.

**Fixed** with one resolver (`Branch::writeTargetId()`) called from both sides,
plus a migration attaching every already-orphaned tank and pump — a station
broken before today would otherwise stay broken after the fix.

**`FuelManagementTest` had 25 tests and every one of them passed**, because
every fixture built its tank with `'branch_id' => $this->branchId()` — always
supplying the field the real client omits. The new regression test goes through
HTTP with the panel's exact payload; reverting the fix turns it red (checked).
Full suite: **2071 passing**. Written up in
[`shopos-forecourt-branch.md`](../decisions/shopos-forecourt-branch.md).

---

### Phase F · the seams — clean

The four places where two correct pieces of code can still make a wrong shop.

| | |
|---|---|
| **The wall between shops holds** | Two real tenants, two real tokens, five vectors: read a product (404), read a sale (404), **sell** another shop's product (422), refund their sale (404), read their drawer (404). This is the only failure in a multi-tenant system that ends the company, so it is checked with ids that genuinely belong to somebody else. |
| **A sale is frozen at its own price** | Re-pricing the product left every earlier sale untouched. A receipt that moves with the shelf price is not a receipt — and it is how a return refunds the wrong amount six weeks later. |
| **A deleted product does not erase its history** | `sale_items` snapshots `product_name`, `sku`, `unit_price`, `item_type`; the sale still reads and still names what was sold. And the deleted product refuses to be sold again (422). |
| **A refund cannot enter a closed shift** | 422. That shift was signed off and its variance already explained. |
| **A module switched off closes its routes at once** | 403 on a **live token**, and `/auth/me` agrees the module went — so the sidebar stops drawing a screen whose every click now fails. Restored afterwards. |

### Phase G · trade depth — clean (after the fix above)

| | |
|---|---|
| **FEFO** | Two lots, far-dated created *first* so insertion order cannot be mistaken for expiry order. The **near** lot is the one that shrank, and it is the one the expiring list names. |
| **A medicine lot must carry an expiry** | Refused outright — not defaulted, not nulled. Every downstream protection reads that column; one nullable row makes all three lie about the shelf. |
| **One serial, one buyer** | Sold, found at the warranty desk by invoice, and refused on a second sale of the same serial (422). |
| **A dish empties the store room** | 3 plates × 2 KG took 6 KG of rice. `recipe_cost` = 400, computed from ingredients on read — so a menu re-costs itself the day its ingredients do. |
| **The forecourt** | More tested than pumped refused (422); 100 metered − 5 test = **95 sold**; the meter carried forward to 1090 for the next shift. |

> **What is *not* an invariant here:** a closing meter reading *below* the
> opening one. A mechanical head rolls at 999999.999, and the code reads the
> smaller number as a roll rather than a recovery — treat it naively and the
> shift reports a million litres of phantom gain on the one report an owner
> reads to find losses. The sweep's first version asserted "a meter cannot be
> wound back", which sounds like a rule and is the opposite of this trade's
> actual one.

### Phase H · offline — clean

| | |
|---|---|
| **A synced sale is re-priced by the server** | Sent with `unit_price: 1`, `line_total: 2`, `tax: 999`; stored as **1000, tax 0**. Without this, "offline mode" is a documented way to pay whatever you like. |
| **The same op cannot bank twice** | A re-send returns `status: duplicate` and the **same** `sale_id`. A lost acknowledgement is the normal case, not the exception. |
| **The OFF- slip finds the sale** | In the sales ledger *and* in the global search box — which is where a cashier actually types it. It is the only reference the customer has; the invoice number was minted hours later. |
| **The delta sends only what changed** | Empty when nothing moved; carries exactly the edited product afterwards. A delta that returns the whole catalog is a full pull with extra steps, and on a 2G forecourt that is the difference between a till that syncs and one that never finishes. |
| **The drawer rules travel** | `pos_blind_close`, `pos_denomination_count`, `pos_declare_tenders` all arrive in the bootstrap — the till cannot look them up at the moment it needs them. |

### `mutate.py` — 10 of 10

Three added for the new phases, each aimed at what a wrong answer would cost:

| Lie told to the sweep | Finding that must appear | |
|---|---|---|
| no request is ever refused | `MART CANNOT SELL RETAIL'S PRODUCT` | caught |
| the wrong lot appears to move | `FEFO TAKES THE EARLIEST EXPIRY FIRST` | caught |
| the synced sale keeps the till's price | `A SYNCED SALE IS RE-PRICED BY THE SERVER` | caught |

**And the third verdict earned itself again.** The stock mutation came back
`UNCLEAR`, not `MISSED`: freezing the stock reading also blinded the sweep's own
restock — which reads the same figure — so the phase rang into an empty shelf
and the stock check never got to run. The harness named a broken *mutation*
instead of accusing a working check. The mutation now fills the shelf for real
before it starts lying.

### HARNESS · nine more, and one worth singling out

| What | Detail |
|---|---|
| **`bootstrap · 3 products` was counting dict keys** | Each collection arrives as `{items, cursor, has_more}`. The sweep read `data.products` as the list, got 3 — the number of **keys in the envelope** — and printed a pass for seven trades. This repo has a standing rule about exactly this: **never assert on an envelope.** |
| The delta cursor is `"<updated_at>\|<id>"` | A space and a pipe. Sent raw it never left the machine; status 0 looked exactly like the endpoint being down. |
| Global search returns `groups[].items` | Reading `data.sales` finds nothing and looks precisely like the slip being unsearchable — the bug that was real in this repo two days ago. |
| The sync returns a receipt **reference** | `{op, status, sale_id, invoice_number, offline_number, violations}`, not the sale. Right: a till that already printed its slip needs the server's number, not the basket read back. |
| `POST /sales/{id}/cancel` … `/z-report` is a GET | A 405 read as a passing isolation check until the verb was fixed. |
| `stock_quantity` on product update is **prohibited** | "Stock changes go through inventory adjustments." The sweep ignored that 422 for several runs, quietly failed to restock, then rang into an empty shelf and reported "Insufficient stock" as five product bugs. |
| A second lot under the same batch number is a **second lot** | Reading only the last row made FEFO look broken. Sum them. |
| The dish's item type is `food_item`, not `food` | The trade is `food`; sending the trade code fails with "only a food dish can have a recipe", which reads like recipes being unavailable to restaurants. |
| Phase C had already closed the drawer | Naming that shift later failed `OwnOpenShift` — the sweep tripping over its own earlier phase. |

> Running total: **21 harness findings, 1 product bug.** The ratio is the
> point. An audit that produces findings is a thing to verify, and the base rate
> says it is the tool.

---

## 2026-08-18 — fourth run · phases A–E

### Phase E · money that is not a sale — clean

The till is the loud half of a shop's money. The quiet half is the electricity
bill, the scrap sold to the kabaria, and the regular who takes goods on khata
and settles on the first. Get selling right and this wrong, and the shopkeeper
is told they had a good month when they did not.

| | |
|---|---|
| **The profit line is arithmetic** | `gross = revenue − cogs` and `net = gross + other_income − expenses`, checked against the report's **own** figures — so it holds whatever the sweep did beforehand. It is a statement about the report's internal consistency, not about this run. |
| **Recorded income reaches net profit** | +777 in, +777 on the profit line. This exact line has been missing here before, and nothing about the screen looked wrong — the number was simply too low. |
| **An expense reaches both books** | Summary and cashbook each +1234, and it comes **off** net profit rather than merely appearing beside it. |
| **The cashbook balances** | `money_in − money_out = net`, and `sales_revenue` never exceeds `money_in` — the cheapest way to catch a broken join in a ledger whose whole design is to *derive* sales rather than duplicate them. |
| **Khata works end to end** | Credit sale +500 on the balance → overpayment **refused** (422 `KHATA_OVERPAYMENT`) → exact repayment clears it to zero. |

### QUERY resolved · sell-on-credit "refused" was the sweep

`payment_method: credit` with `amount_paid: 0` → **422, "Amount paid (0.00) is
less than the total (500.00)"**, on every trade. That reads exactly like khata
being broken — a shop unable to give goods on credit at all.

It is not. **The credit tender COVERS the bill**, and the money then moves onto
the customer's balance; `amount_paid` is the full total. The till sends exactly
that ([`PosPage.tsx:1036`](../../shopos-admin-and-user-panel/src/modules/pos/pages/PosPage.tsx#L1036)),
and the rule underneath is that a bill is never left partly unaccounted for.
Two further rules sit beside it, both deliberate: a khata sale needs a linked
customer, and it may never produce cash change — otherwise a fat-fingered credit
amount turns the POS into a cash dispenser.

The sweep now sends what the till sends. **12 harness findings, 0 product bugs.**

### `mutate.py` — 7 of 7

Two added, both aimed at silent-failure shapes this codebase has already seen:

| Lie told to the sweep | Finding that must appear | |
|---|---|---|
| net profit never moves | `INCOME REACHES NET PROFIT` | caught |
| khata balance never moves | `CREDIT SALE LANDS ON THE KHATA` | caught |

---

## 2026-08-18 — third run · phases A–D

### Phase D · the shelf, away from the till — clean

Goods arrive, get counted, get thrown away, get corrected by hand. Each path
writes to the same number, and the till is not where you find out one is wrong.

| | |
|---|---|
| **Moving cost blends on receive** | 42 held at Rs 358 + 10 at Rs 600 → **404.29**, the weighted average. Not last-price (600), not unchanged (358), never blanked. This is the quietest number in the system: get it wrong and every margin is fiction while nothing errors. |
| **Adjust in/out/set** | +5 −2 lands exactly; `set 42` means 42, not 42 added. |
| **Adjust below zero refused** (422) | And the refused adjust changed nothing — a refusal that half-applies is worse than either answer. |
| **Oversell refused** (422) | Consistently, on every trade. Stock never went negative. |
| **A stocktake overrules the books** | Counted 7, applied, shelf reads 7. |
| **The ledger names its causes** | `sale`, `sale_return`, `sale_cancellation`, `purchase_order`, `stock_count`. |

**`type` is only ever `in`/`out`/`set` — by design.** The first read of this
looked like a ledger where a sale and a hand adjustment are indistinguishable.
They are not: the cause lives in `reference_type`, and that split is what makes
the table usable during a dispute, which is the only time it is read. The check
was rewritten to ask the real question — *can you tell a sale from somebody
typing a number* — rather than counting `type` values.

### `business_category` is not only a label — confirmed from outside

A food tenant created with `business_category: "restaurant"` arrives with the
**inventory** module on; a food tenant with no category does not. That is its
**one** behavioural use out of seventeen (the other sixteen are display and
search), and it now has a check of its own precisely because it is the only one:
if it silently stopped working, every restaurant would be unable to track a
single ingredient, and the screen that sets it would still look fine.

The rule only ever turns inventory **on**. A sub-type must never take away what
the parent type grants, or the two argue and the type loses.

### `mutate.py` — and the day it lied about the sweep

169 green checks prove nothing on their own, so `mutate.py` breaks the sweep on
purpose and requires the matching finding to appear.

| Lie told to the sweep | Finding that must appear | |
|---|---|---|
| stock never moves | `SELLING TAKES STOCK OFF THE SHELF` | caught |
| expected price doubled | `SERVER PRICES THE SALE` | caught |
| every refusal reads as success | `SALE VOIDED TWICE` | caught |
| cost never moves | `RECEIVE DID NOT MOVE THE COST` | caught |
| movements lose their cause | `A SALE LEAVES A TRACEABLE MOVEMENT` | caught |

**5 of 5** — but only after the harness stopped lying.

Two mutations first came back `THE CHECK IS BLIND`. **Both checks were fine.**
The phase had died partway through on a **429** — the general 240/min limit,
tripped by five sweep passes back to back — so the check never ran, and the
harness reported silence as blindness.

> A detector with no denominator, inside the tool written to find detectors with
> no denominators. The second time this exact shape has appeared in this repo.

Fixed in two places, and neither was "loosen the limit":

1. **The client waits out a 429 once**, using the server's own `Retry-After`.
   A sweep that trips a rate limit and calls the result a finding manufactures
   bugs — this one nearly did.
2. **Every mutation now names a `ran_marker`** — a row that appears only if the
   check executed. Three verdicts, not two: `CAUGHT`, `MISSED` (the check ran
   and said nothing — a real hole), and **`UNCLEAR`** (the check never ran —
   fix the run, not the code).

One of the five was also a **bad mutation** rather than a blind check: it
received goods at the price the product already held, under which a blended cost
and an unchanged cost are the same number, so nothing could be detected.
**A mutation that cannot fail is the same mistake as a check that cannot fail,
one level up.**

### HARNESS · one more

| What | Detail |
|---|---|
| `throttle:api` is **240/min per user** | Five mutation passes exceed it. Same lesson as the login throttle one layer up: the limit is the product working. |

> Running total: **11 harness, 0 product bugs.**

---

## 2026-08-18 — second run · phases A–C

### Phase C · selling — clean, and the sweep was made to prove it

**126 checks, 0 bugs, 0 queries** across seven trades (finance has no till and
is skipped, correctly). The chain, per shop: open the drawer → put something on
the shelf → ring it → return part of it → void another → move cash → read the
drawer → count it out.

A green run means nothing on its own, so `mutate.py` breaks the sweep on
purpose and checks it complains:

| Lie told to the sweep | Finding that must appear | |
|---|---|---|
| stock never moves | `SELLING TAKES STOCK OFF THE SHELF` | caught |
| expected price doubled | `SERVER PRICES THE SALE` | caught |
| every refusal reads as success | `SALE VOIDED TWICE` | caught |

**3 of 3.** Only now does the green run above mean anything.

### What Phase C actually confirmed

| | |
|---|---|
| **Server-authoritative pricing holds** | A sale posted with `unit_price: 1`, `line_total: 2` and `tax: 999` on a product priced 500 was charged **1000, tax 0**. The fields are dropped silently rather than refused — right, because a shop on an old client should keep selling at the correct price, not stop selling. |
| **The shelf and the drawer agree** | sale −3, return +1, void +2; expected cash = float + net cash − paid-out + paid-in, to the paisa, on every trade. |
| **A sale cannot be voided twice** | Second cancel → **409**. This is the double-restock bug class this codebase has been bitten by; it is closed. |
| **Blind close really is blind** | `expected_cash` and `cash_sales` are *unset* from the X-read for anyone without `SUPERVISES_TILLS` — the person being counted is not told the answer first. |
| **A service holds no stock** | `track_inventory` and `stock_quantity` are `prohibited`, not merely ignored. |

### QUERY resolved · `GET /shop/business-type` → 404

**Correct behaviour. No endpoint is missing.** A trade's units and variant
attributes ride the public `/business-types` catalog, and the shop picks its own
row out of it — the list is identical for every tenant of a trade, so a
per-tenant endpoint would be the same data behind a login and a cache nobody
could share.

The lookup matches on **`business_type_primary`**, and that is load-bearing: the
catalog *hides* legacy codes, so a shop still carrying `restaurant` or `clinic`
finds no row at all if the raw code is used — no units, no variant attributes,
silently. [`ProductFormPage.tsx:233`](../../shopos-admin-and-user-panel/src/modules/catalog/pages/ProductFormPage.tsx#L233)
reads the primary. The sweep now reads the same field, or it would be testing a
lookup that does not ship.

### HARNESS · four more, all of which looked like product bugs

| What | Detail |
|---|---|
| `POST /sales/{id}/cancel` needs **`reason_code`** | From a fixed list, free text optional beside it. A free-text-only void is unreportable — "why do we void forty sales a week" cannot be answered by reading forty sentences. |
| `expected_cash` lives under **`drawer`** | The X-read is `{session, drawer, movements, covers, …}`. Reading the envelope's top level finds nothing and looks exactly like a missing field. |
| A return's amount is **`refund_total`** | Not `total`. The sweep reported "refunded 0" while the drawer's own figure was 500 lower — **the run contradicted itself**, and when two of your own numbers disagree, one of them is the harness. |
| Login is **5/min per IP**; the sweep drives 9 identities | Fixed properly: tokens are cached to `.tokens.json` between runs and revalidated with `/auth/me`, and a 429 is waited out using the server's own `Retry-After`. A looser limit would have been the wrong fix. |

> Running total of harness-vs-product: **10 harness, 0 product bugs.** Every one
> of the ten was reported as a defect on first read. The sweep is now the most
> tested thing in this repo, which is the correct order.

---

## 2026-08-18 — first run

### Phase A · admin side — clean

8 tenants created, one per primary business type, each on the Basic plan.
Every module the type **proposes** arrived granted. No dollar sign anywhere in
the plan payloads.

| | |
|---|---|
| `Sweep Food` … `Sweep Petroleum` | `sweep-<type>@qa.test` / `password` |

### Phase B · per-trade — 2 of 8 completed, 1 query open

| Level | What | Detail |
|---|---|---|
| **QUERY** | `GET /shop/business-type` → **404** | The sweep expected an endpoint serving the trade's units and variant attributes to the shop. It may not exist under that name, or the data may travel inside `/auth/me`. **Needs checking before it is called either way.** |
| HARNESS | 6 of 8 owner logins failed | Login is **throttled**, and the sweep tried eight in one second. Spaced out, every one succeeds. The throttle is correct — the sweep must back off. |
| HARNESS | second run reported 8 "bugs" | "A business with this name already exists" — the console refusing a duplicate, correctly. A sweep that can only run once is a sweep nobody runs. **Fixed:** it now reuses the tenants it made. |
| HARNESS | `/auth/login` takes `identifier` | Not `email` — the field accepts an email **or** a phone, so naming it `email` would be a lie the day a shopkeeper types their number. |
| HARNESS | `/business-types` returns a **list** | Not a map keyed by code. The first version reported all eight types missing, which looked exactly like a product bug. |
| HARNESS | `POST /admin/tenants` needs `plan_id` + nested `owner` | A tenant with no plan has no ceiling and no billing period — a state nobody chose. |

> Four of the six harness findings looked like product bugs on first read. **An
> audit that produces findings is a thing to verify, not to believe.**

### Not yet run

Phases C–H. See [`QA-SWEEP-RUNBOOK.md`](QA-SWEEP-RUNBOOK.md) for the order and
why it is the order.

---

## How to resume

```bash
cd shopos-backend && php artisan serve --port=8000     # if not already up
cd docs/qa/sweep && python3 -c "
import sys; sys.path.insert(0,'.')
from api import Api, Report
import phase_a, phase_b
api, rep = Api(), Report()
rep.summary() if not phase_b.run(api, rep, phase_a.run(api, rep)) else None
"
```

```bash
cd docs/qa/sweep
python3 run.py        # every phase, in order
python3 mutate.py     # prove the sweep can still fail
```

Both are re-runnable: Phase A reuses the tenants it made, Phase C reuses and
restocks its product, and a drawer left open from last time is picked up rather
than fought with.

**All eight phases are built.** What is worth doing next:

1. **Depth inside the phases**, not more phases: multi-branch transfers, stock
   disposals (written-off vs returned-to-supplier must never sum), loyalty
   points, promotions and coupons, dine-in tabs and KOT, layaway, trade-ins as
   a tender.
2. **Permissions as their own axis.** Every phase so far runs as an owner, who
   passes every gate. The `*.manage`-fencing-a-read bug class lives exactly
   where a cashier, a waiter or a kitchen preset is the one asking.
3. **The panel**, which the sweep never touches. It drives HTTP only, so a
   screen that never calls a working endpoint is still invisible to it — the
   "built but unreachable" class this repo has hit seven times.

Still open, unrelated to the sweep: the two-week shadow run, and `code128Svg`
needing a barcode sized by the symbol.

Still open, unrelated to the sweep: the two-week shadow run, and `code128Svg`
needing a barcode sized by the symbol.
