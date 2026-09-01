# One shop's day, per trade — the working ledger

> **This file is the resume point.** If a session ends mid-way, read the
> checklist at the bottom, find the first unticked box, and carry on from there.
> Every box is a self-contained commit.

## Why this exists

The supplier `Pay` button settled nothing for weeks inside a green suite. The
reason was not a missing test — `CashMovementTest` had been posting to that
endpoint since August. The reason was that **no test ever asked what the
balance did afterwards**. Coverage was there; the consequence was not asserted.

That is the shape of every miss this codebase has had:

| miss | what was covered | what was never asked |
|---|---|---|
| supplier Pay | the endpoint returned 201 | did the balance move |
| sized parent adjust | the endpoint returned 201 | did the shelf move |
| low stock | each screen answered | did the screens agree |
| 86 / sold-out | the till refused | did the other two doors refuse |
| discount ceiling | the till capped it | did the online door cap it |

So the strategy is not "more tests of each feature". It is **one day, run end to
end, per trade, where the last step is a chorus**: ask every surface that can
answer a question, and require the same number from all of them.

## The day

    shop created → catalog → supplier → PO → receive
      → day/shift open → sell (cash · card · khata) → return
      → khata repaid → supplier paid → expense
      → shift close → day close → THE CHORUS

## The chorus — one question, every surface

Each question is put to two or more surfaces that compute it *independently*.
Disagreement is the finding; the number itself is secondary.

| # | the question a shopkeeper asks | surfaces that must agree |
|---|---|---|
| Q1 | what did the shop take today? | day close · cashbook · sales report · dashboard |
| Q2 | what should be in the drawer? | Z-read · day close · session report |
| Q3 | what do we owe suppliers? | supplier card · dashboard · purchases report |
| Q4 | what do customers owe us? | customer statement · dashboard · khata report |
| Q5 | what is on the shelf? | product · inventory list · valuation report |

## The denominator

A day that quietly skips a module proves nothing about it. So the flow records
which modules it touched, and the test fails naming any module the trade has
**enabled** that the day never went near. Adding a module to a trade breaks this
test until the day covers it — that is the part that makes a future miss loud.

## Trades

food · mart · pharmacy · retail · services · automotive · petroleum · finance

Deep walkthroughs already exist for **mart**, **food**, **pharmacy** and
**finance** (books-only). They are not replaced — this runs *beside* them and
asks the cross-module question none of them asks.

---

## Checklist

- [x] **C1** — `ShopDay` helper + the spine + Q1/Q2, mart only, green
- [x] **C2** — all 8 trades through the spine — 7 that sell run the day; finance
      is asserted from the opposite end (no till, no day, books still kept), so
      the provider cannot quietly shrink to seven rows
- [x] **C3** — Q3/Q4/Q5 added to the chorus
- [x] **C4** — the module denominator ratchet: every module a trade ships with
      is either walked or excused **in writing**. Adding a module to a trade
      turns this red until somebody decides. Mutation-proven (dropping
      `expenses` from the walked list names 17 trades).
- [x] **C5** — the OTHER DOORS. Not per-trade specials in the end: the trade
      suites already own those (`FuelManagementTest` alone covers the forecourt
      in thirty tests). What nothing owned was the other ways a `Sale` row comes
      into being — see F3 below.
- [x] **C6** — fixed inline as each was proven: F1 (the drawer), F2 (the
      vanishing ticket), F3 (the other doors). Nothing is carried as a known
      bug.
- [x] **C7** — `docs/decisions/shopos-a-day-and-its-chorus.md`, HANDOVER ×2,
      memory `shopos-day-and-chorus`, Help Centre (POS · Day · Reports).

### Still open

- [x] **C8** — done, and it found that F3's own fix was half a rule. See F4.
- [x] **C9** — the two spellings agree today only because `SaleStatus` has
      exactly four cases. Written down as `WhichSalesCountTest`, whose failure
      message SCANS for the other spelling rather than listing it — it names
      four files and nine sites. Mutation-proven.

### Still open

- [x] **C10** — ran Playwright, which had not seen a screen since the relation
      optionality change. One failure, on the screen this work had just
      touched. See F5.
- [x] **C11** — three more chorus questions: what the item earned (Q6), what
      went to the bank and what is still in the shop (Q7), and the staff report
      as a fifth answer to Q1. Q6 immediately caught F6.

### Still open

- [x] **C12** — every Playwright project run, with the configured reporters:

      | projects | passed | skipped |
      |---|---|---|
      | restaurant ×3 | 21 | 2 by project |
      | tablet ×2 | 116 | 26 by project |
      | storefront ×2 · trade ×6 | 37 | 75 by project |
      | desktop · phone | 129 | 13 by project |

      **303 passed, 0 failed**, and every run ended `Every other check ran. No
      spec talked itself out of existence.`

### Still open

- [x] **C13** — the EDIT MATRIX. The two scanner findings collapsed into one
      question and one file. See F7 and F8.

### Still open

- [x] **C14** — the matrix now reaches all of them, and found the same mistake
      a third time. See F10.

### Still open

- [x] **C15** — ran every scanner the repo already has. Three green;
      `dead-rules.py` red. See F11.

### Still open

- [x] **C16** — ran the parent-repo scanners too. `screen-permission-drift`
      green; `unreachable-pages` red. See F12.

### Still open

- [x] **C17** — re-ran `untested-absence.py` to check my own work, and found
      the scanner could not see it. See F13.

### Still open

- [ ] **C18** — 10 optional fields still supplied by every test, mostly the
      forecourt's (`capacity_litres`, `current_dip_litres`, `dead_stock_litres`,
      `current_reading`). A tank with no capacity and a nozzle with no opening
      reading are both branches nobody has driven down, and both feed gates that
      need a number to compare against.

      Note for whoever runs these: **do not pass `--reporter`**. It replaces the
      configured list, and the first restaurant run reported "2 skipped" while
      `skipReporter` — the thing that says WHICH — had been switched off by the
      flag asking for a reporter.

## Where the day stands

| | |
|---|---|
| trades running the full day | 7 (food · mart · pharmacy · retail · services · automotive · petroleum) |
| finance | asserted from the opposite end — no till, no day, cashbook still kept |
| chorus questions | 7 — takings · refunds · drawer · khata · shelf · payables · what the item earned · what went to the bank |
| sale doors put through the drawer | 7 — counter · quote→invoice · exchange · dine-in tab · pickup order · delivery order · reservation, plus an offline replay that must reach none of them |
| mutation-proven | Q1 (Takings), Q3 (supplier card), Q5 (valuation units), C4 (module ratchet) |

Q4 was rewritten after it was found to be weak: the customer card, the customer
list and the dashboard all read the SAME `credit_balance` column, so they could
not disagree. It now asks the column, the statement's newest running balance,
and the statement RE-ADDED from nothing.

## Findings

_(appended as they are proven — never as they are suspected)_

### F1 — only the till ever told the drawer a sale had happened  ·  FIXED

**Measured.** One mart day: 40 bags bought in, three sales rung through
`POST /sales` (cash 1,000 · card 500 · khata 750), one bag refunded in cash,
a khata payment taken, the supplier paid and a wage bill paid — all with a
drawer open.

| | said | should have said |
|---|---|---|
| the day, closed off | **0** | 2,250 |
| the drawer's expected cash | **100** | 850 |

`cash_session_id` is offered by four doors and filled by one:

| door | fills it |
|---|---|
| the till (`PosPage`) | yes |
| Sales → New Sale | no |
| the returns desk | no field at all |
| dine-in settle · quotation → invoice | passes through whatever it was given — nothing |

Money *leaving* the drawer has resolved itself server-side all along
(`RecordCashMovementAction`: "the session, lane and branch are resolved
SERVER-side from the caller"). Money *arriving* did not. So the afternoon's
expenses came out of a drawer that had never heard about the afternoon's
takings, and `BusinessDay` — which sums the shifts — closed off at zero.

`SaleController` had already written the fault down in its own comment
("whose cash belongs to no reconciliation and shows up in no shift report")
and answered it only for shops that switch on `pos_require_shift`, which
ships **off**.

**Fix:** `BooksDrawer::tillFor()` — one rule, the mirror of the one that
already existed for money going out. A practice till answers null, or a real
sale would silently become a practice one.

### F3 — three of the four doors that ring a sale never moved the drawer  ·  FIXED

F1 was found through the front door. This is how wide it actually was.

A `Sale` row is created by six different paths, not one. Put the same cash
through each with a drawer open, and read the X-read a cashier would pull:

| door | drawer moved (before) | should |
|---|---|---|
| the counter | **0** | 400 |
| a quotation turned into an invoice | **0** | 300 |
| an exchange with a top-up | **0** | 100 |
| a dine-in tab, settled | **0** — day closed at zero too | 1,800 |
| an online order completed | 0 | **0** |

The restaurant case is the worst of them: a food shop trades almost entirely
off its floor, so before the fix a restaurant's whole day closed off reading
**zero** while its cashier counted a drawer full of money the till had never
heard of.

The last row is the one that keeps the rule honest. An online order completing
is not a sale rung at a till — the rider is still out with the goods, or the
card was taken on the website — so the resolution is fenced to counter
channels. A drawer that expects money which never crossed it is the same bug
pointed the other way, and it is worse: the cashier counts SHORT, and short is
what people get accused over.

Mutation-proven: removing the resolution turns three doors to 0 and leaves the
online one alone.

### F7 — a coupon could not be edited one field at a time  ·  FIXED

The edit matrix's first run. `CouponController::update` used the **store**
request, so changing a coupon's expiry meant resending its code, its type and
its value:

    422 {"type":["The type field is required."],"value":["The value field is required."]}

Promotions, riders, branches, categories and collections all have their own
update request. Coupons were the one resource that did not, and the difference
was invisible because the screen happens to send the whole form every time —
a screen's habit, not a contract.

### F8 — a fixed promotion could not be raised above Rs 100  ·  FIXED

The better half of the same run, and the exact shape the scanner pointed at:
`type` is an optional field that every test supplies.

`UpdatePromotionRequest` read `type` out of the INPUT with a default of
`percent`, so a partial edit that did not resend it was validated as a
percentage. A shop raising a Rs 50 fixed discount to Rs 5,000 was told:

    422 {"value":["The value field must not be greater than 100."]}

A percentage rule applied to a rupee amount, naming a field the shop was not
trying to change. Fixed by `ValidatesAgainstTheStoredRecord`: the missing half
comes off the ROW, because what the record will look like after the edit is the
only thing worth validating against.

**What the matrix also proved:** the other ten endpoints are correct. Branches,
categories, customer groups, riders, collections, banks, bank offers, tanks,
pumps and tables all leave untouched fields alone, and a collection keeps its
items through a rename. Mutation-proven by making a branch update blank its own
`code`.

### F13 — a khata given to somebody the till can never name  ·  FIXED

Re-ran `untested-absence.py` to check whether the edit matrix had closed the
fifteen untested routes. It said thirteen were still untested — **and it was
wrong**, because the matrix dispatches through `->{$verb.'Json'}($url)` and the
scan looks for a literal verb beside a literal path. Twelve routes it listed
were being posted to.

That is worse than a miss: the next person reads the list and writes the tests
again. The scan now recognises a verb and a path handed to a helper as
arguments, and the count went **13 → 0**. (The general answer is not a regex —
record the routes the suite actually hits at runtime — and that is written down
in the script.)

With the noise gone, the field list was readable, and the sharpest entry was
`POST /customers` · `phone`, supplied by all seven tests that create a customer.

**Every path that puts a name to a sale keys off the phone and nothing else.**
`StoreSaleRequest` carries `customer_phone` and no `customer_id`; the group
discount, the loyalty balance and `Customer::capture` all look up by number.
Loyalty says it out loud: *"Redeeming points needs a customer — add the
customer's phone."*

The CRM did not. `Phone` was a plain optional box sitting directly beside
`Credit limit (khata) — blank = no limit`. Measured: **a customer created with a
Rs 50,000 credit limit and no phone, accepted 201.** That is money that cannot
be lent, repaid or chased, and nothing said so until a cashier was at the till
with the customer in front of them.

Now refused, on the `phone` field, with the reason. A customer with no number is
still fine — plenty of shops keep a directory of walk-in names; the LIMIT is
what needs reaching them. On an edit the rule reads the record as it will be, so
raising the limit of a customer already on file is not refused for a field
nobody resent, and clearing the number of a customer who HAS a limit is.

The form says it before the server does, and the Help Centre says it too.

### F12 — the two admin queues could not reach page two  ·  FIXED

`docs/qa/unreachable-pages.py`, run because the list was empty again. Three
findings, and the page-two class for the **fourth** time.

| screen | endpoint | |
|---|---|---|
| Enquiries | `paginate(25)` · `orderBy('created_at')` | page one only |
| Shop requests | `paginate(25)` · `orderBy('requested_at')` | page one only |

Both queues are **oldest-first, deliberately** — "the person who has waited
longest is the person to answer next" — and that is exactly what made the
missing pager permanent rather than merely annoying. Once twenty-five pile up,
page one never changes again, so:

- a visitor asking for a **walkthrough** is never seen;
- a demo that pressed **Keep this shop** — a business asking to start paying —
  sits behind twenty-five others for ever.

And the headline count was wrong in the one place it is the point of the screen:
`unanswered` and `waiting` were `list.length`, which caps at the page size. An
admin with sixty people waiting was told **25**. Both now read the pagination
total.

The third finding was not a paging bug at all: `useMarketProducts` had **no
caller** — a hook the aisle rebuild left behind. Removed, with its service
method.

**And the scanner had a blind spot of its own.** Removing that method made
`marketplace/shops/{slug}/products` "a paginating route named by no screen" —
except the **phone app** calls it. The scanner reads the panel only, and the
natural next step from "nobody names it" is to delete it. It now reads the phone
too and reports such routes under their own heading; blind mode blinds the phone
as well, so `--prove` still holds.

### F11 — the platform console counted demo shops as businesses  ·  FIXED

Not found by a test — by running the scanners the repo already had.
`scripts/dead-rules.py`: **`Tenant::real()` is asked by nobody, and nobody has
said why.**

Its own docblock names the callers:

> the places that must exclude it are the marketplace, every platform figure
> and every admin list

The marketplace fences demos itself (`marketplaceVisible()` has its own
`where('is_demo', false)`), which is exactly why nobody noticed the rest. Every
platform figure counted a shop a stranger was handed from the landing page and
which is deleted the next day:

| | |
|---|---|
| `tenants.total` · `active` · `suspended` · `online_shops` | demos included |
| `new_this_month`, and its KPI | demos included |
| the growth chart | demos included |
| the business-type spread · plan spread · module adoption | demos included |
| the five most recent shops | demos included |

Measured: **5 reported where 2 were businesses.**

`new_this_month` is the worst of them. Demos are given away from a public page,
so a growth figure that includes them is a marketing metric measuring its own
landing page.

Fixed by calling the rule that was already written, and the demos are published
on their own line rather than dropped — "how many people are trying it" is a
real question. `scopeDemo()` names the other half so the two stay complements,
and `PruneDemoShops` now uses it instead of spelling `is_demo` inline.

### F10 — a banner lost its own settings when somebody fixed a typo  ·  FIXED

The rest of the edit matrix: platform staff, announcements, banners, and the
PATCH verb on coupons and promotions. Everything passed except one, and it is
**the same mistake as F8, for the third time**:

    POST /admin/banners/{id}   {"title": "Eid Offers"}
    → 422 {"tenant_id":["Pick the advertiser shop for a shop banner."]}

`BannerRequest::withValidator` read `$this->input('target_type', 'shop')`, so an
edit that changed only the title was validated as a brand-new SHOP banner and
demanded an advertiser the admin had chosen weeks earlier. `target_type` is one
of the nineteen fields every test supplies — the scanner pointed straight at it.

Fixed with the same `ValidatesAgainstTheStoredRecord`, extended to the fields
the rule depends on: the question is what the banner will HAVE after the edit,
not what this request happened to mention.

Worth noting where the pattern was already right: `UpdateProductRequest` loads
the product from the route and validates against it. Three requests had simply
not followed the house pattern, and nothing pointed at them until an edit was
attempted with one field.

The update over POST is the detail that hid these: a banner and an announcement
are edited by POST because they carry an image, so they do not look like edits
in a route list at all.

### F9 — the third calendar failure, and a scanner for the fourth  ·  FIXED

Five tests went red overnight, in `StockReportsTest` and `PosSyncTest`, all
about reports returning nothing. **Not the margins netting** — proven by
`git stash`, which left them failing on committed code.

`period=monthly` is `startOfMonth`→`endOfMonth`, and those fixtures sell on
`now()->subDay()`. On the 1st that is the previous month. This machine runs at
UTC+5 while the app runs UTC, so the suite crossed the boundary at seven in the
evening local time — "it passed this morning" was true and useless.

Third occurrence (`AutoWorkshopTest` and `BillingSaysHowMuchTest` were pinned
for the same reason on 31 August), so this one got a scanner rather than a
third fix: `scripts/clock-dependent-tests.py`.

Its first version flagged two walkthroughs that were in no danger — they use
`now()->subDay()` as a QUERY BOUND, and asking about a wider window cannot push
a sale outside it. Sharpened to ignore lines that are asking rather than dating,
then mutation-proven: unpin `StockReportsTest` and it names it.

### F5 — the reports page scrolled sideways, 8px at a time  ·  FIXED

Playwright's `chrome.spec` sideways rule, on the desktop project. **1288px of
content in a 1280px window** — on the one screen this work had just changed.

The cause was not the new Refunds card. It was `MetricCard`, which had no
`min-w-0`:

```
div.grid ... xl:grid-cols-6   scrollW=974  clientW=942
  div.rounded-2xl (a card)    scrollW=205  clientW=135
    h4 (the money value)      scrollW=181  clientW=87
```

A grid item defaults to `min-width: auto`, so it refuses to be narrower than
its content. `Rs 2,358,634.50` wants 181px and the card had 135, so the value
did not overflow the CARD — it widened the column, then the grid, then the
page. Nothing looked broken; the whole page just moved.

Six across only ever fit because the numbers in front of it had been small.
Making revenue count partially-refunded sales (F2) pushed the sweep tenant's
figure to seven digits and it stopped fitting.

Fixed in the shared component (`min-w-0`, `break-words`, `tabular-nums`) so it
can never push a page again, and the reports row is four across at xl so it does
not have to. Same family as the shell's `flex-1` with no `min-w-0`.

Three probes were needed. The first two measured the wrong thing: they listed
elements whose right edge exceeded the viewport, which found only the Appearance
drawer — `position: fixed`, off-canvas, and contributing nothing to document
overflow. Asking instead *which element's own box scrolls* named the card in one
run.

### F6 — my own fix left a returned unit counted as sold  ·  FIXED

Giving `margins` and `topProducts` the shared `Takings::COUNTED` rule (F2)
stopped them dropping a whole ticket — and left them counting the returned unit
at full value. Better than before, still wrong, and wrong because of this work.

The P&L and the margin table have opposite models of a refund on purpose. The
P&L keeps revenue GROSS and reports refunds beside it, because a refund is dated
by the day the money left and must not rewrite a day already banked. The margin
table has no per-item refund column and is keyed by the day the goods were SOLD,
so it nets at line level. Different arithmetic; the same answer.

Q6 measured it: **profit −74 and 9 units, where the day earned 176 on 8.**

### F4 — the fence I put on F3 was itself half a rule  ·  FIXED

F3 fenced the drawer resolution to counter channels, on the reasoning that an
`online` sale did not cross the till. C8 then put the last two doors through it
and showed the reasoning was wrong in one direction:

`channel` says where the ORDER came from. It does not say where the MONEY was
taken, and the two part company at the door:

| door | channel | where the money was taken |
|---|---|---|
| a reserved item collected | `online` | **the counter** — `ReservationService::complete` is documented "customer arrived" |
| a pickup order collected | `online` | **the counter** |
| a delivery order | `online` | the rider |

So a customer who reserved a Rs 5,000 item, walked in and paid cash would have
left the drawer short by the whole amount — the original bug, still live, in the
fix for it.

`fulfillment_type` is the only field that knows the difference. Callers that
know now say so (`collected_at_the_counter`); the channel-shaped guess is used
only when nobody does. The matrix carries all six doors and both signs.

Mutation-proven: making delivery attach, and making the reservation stop
attaching, each produce their own line.

### F2 — a refunded item takes the whole ticket off the sales report  ·  FIXED

**Measured**, same day. The cash sale of 1,000 had one 250 bag returned, so
its status became `partially_refunded`:

| surface | said | |
|---|---|---|
| cashbook · day · Z-read | 2,250 | counts the three live statuses |
| **sales report · dashboard** | **1,250** | drops the whole 1,000 ticket |

1,250 is neither gross (2,250) nor net (2,000). "Which sales count?" is asked
in **13 places** across `ReportService` and `DashboardService` and answered
`Completed` only — revenue, the chart, top products, margins, the staff
report and the tax report all lose a ticket the moment any part of it comes
back. Five other places (`DrawerMath`, `LedgerService`, `StockReportService`,
`PosController`) already use the wider set.

**Fix:** `App\Support\Takings` — one copy of the rule. Revenue stays GROSS
with refunds as their own dated line (a return on Thursday against Monday's
invoice cannot rewrite a Monday that has been closed and banked), so
`summary()` and the dashboard gained a `refunds` figure, both profits subtract
it, and `cogs` loses the returned goods' snapshot cost. Panel shows the line
only when there is one.

Gates after both: backend **2391 passed, exit 0** · panel tsc 0 · eslint 0 ·
vitest 1334 · build 0.
