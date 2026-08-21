# QA sweep — findings

Newest first. Each row is reproducible from the call recorded beside it.

**Three levels.** `BUG` is a defect. `QUERY` is behaviour that differed from the
sweep's expectation and needs a human decision — **about half of these turn out
to be correct behaviour nobody had written down**, and finding those is worth as
much as finding a defect. `HARNESS` is the sweep itself being wrong, kept
because a harness bug that looks like a product bug is the most expensive kind.

---

## 2026-08-21 — the type made entirely of money screens, never driven

The per-type table below turned up one real gap, and this closes it.

**`finance` has one module: `expenses`.** No till, no catalog. Phase C needs a
till, so it skipped the shop outright — and every phase after C reads phase C's
output, so **17 of 19 phases had never once spoken about it.** The money screens
themselves were covered, on other shops. *The one business type made entirely of
money screens had never been driven end to end.*

### Why it could not simply be added to `sold`

`sold` means "a shop that can ring a sale", and **thirteen phases index
`state["product"]` without asking**. A product-less state in that dict breaks
them. So the fix is a second, smaller mapping — `phase_c.BOOKS_ONLY` — handed
only to the phase that can use it, and nothing else changes.

Everything in phase E except the khata needs nothing but a token: an expense
reaching the summary and the cashbook, income reaching net profit, the cashbook
balancing, and profit being arithmetic. A khata charge is a SALE on credit, so
it stays behind the till gate and the run says so rather than skipping quietly.

**`finance` now answers all nine**, and the full run went 1743 → **1752 ok ·
0 to look at · 0 bugs**. Real figures, not a no-op: expense +1234
through summary, cashbook and net profit; income +777; `cashbook balances — in
1554 − out 2468 = -914`; `net = gross + income − expenses`.

### And the gap cannot silently reopen

Phase E joins `GATES` as `expenses` — deliberately not `pos`, which is the whole
point of the books-only route. The run now compares what phase E covered against
every shop whose modules say it should have.

Proven by cutting the route: the summary answers

```
  E    8  automotive, food, food_restaurant, mart, …   ·  SILENT ON: finance
```

*A coverage gate tests REACH; a mutation tests a CHECK.* This gap was never a
check that could not fail — it was a check that never ran, and only the
denominator could ever have shown it.

---

## 2026-08-21 — the sweep asked as nobody, and reported 96 bugs

Asked a plain question — *has every business type been driven?* — and ran the
whole sweep to answer it. It printed **96 bugs**. Eighty-eight of them said
`401 Unauthenticated`, and one said *"the shop has a Main branch — 0 branches"*
about a shop with **eighteen**.

None of them were about the product.

### HARNESS · a call with no credentials is not an answer

`Api.login()` returns `None` when a sign-in cannot be had — a cold token cache
plus `throttle:auth` at 5/min per IP, and a full sweep drives about a hundred
identities. The phase then called on with `token=None`, which falls through to
an ambient token that was **also** None, so the request went out **bare** and the
server correctly said 401. The sweep printed each one as a defect.

This is the sibling of the bug `api.py` already carried a long comment about —
*"a permission probe that ran as the WRONG IDENTITY"* — and the existing
`NOBODY` sentinel guarded only the deliberate case. Asking as nobody **by
accident** had nothing standing in front of it.

Three fixes, and the second is the interesting one:

1. **A request that would go out with no credentials does not go out.** It
   returns status `0` and `HARNESS_NO_TOKEN` — a status no route ever returns,
   so no caller can mistake it for a refusal. And `run.py` **fails the whole
   run** when even one occurs, with the line *"nothing above is evidence about
   the product"*. A summary that cannot be trusted must not read like one that
   can.
2. **A sign-in is the one call that is SUPPOSED to be anonymous** — and the new
   guard promptly blocked it, so the first run after the fix reported *"admin
   can log in — refused"*. `_login_fresh` now says `NOBODY` explicitly, which is
   what it always meant.
3. **A failed sign-in reports the server's own answer.** Phase A said
   `"admin@shopos.test refused — is the seeder run?"` about an account that logs
   in fine, throwing away the status that would have explained it in one glance.
   It carries `why_login_failed()` now.

Login retries also went from 4 to 10: `throttle:auth` is 5/min and a cold cache
needs minutes of pure waiting. **A slow run beats a wrong one.**

**96 bugs → 3.** And 0 calls made as nobody.

### HARNESS · a throwaway probe left the sweep lying

Two of the surviving three were **mine**. The ad-hoc probe written that morning
to measure the audit trail had suspended a sweep cashier and set the retail
shop's discount ceiling to 12% — and left both that way. The standing sweep then
reported, correctly and uselessly:

- `I retail · cashier can sign in` — because the cashier was suspended;
- `M retail · DISCOUNTS.APPLY ACTUALLY GRANTS IT — 403 This discount is 80%,
  above the 12% limit` — because the shop now had a ceiling, which is the
  feature shipped the day before.

> **A throwaway probe that mutates the sweep's shops leaves the standing sweep
> lying, and the lie outlives the probe by days.** A probe either restores what
> it touched or works on a shop of its own.

### HARNESS · phase G never restocked, so the shelf ran dry

The third: `G petroleum · sell a serialized unit — 422 Insufficient stock: only
0 in stock`. The serialized product is created with fifty units and **never
topped up**, so every run ate one and eventually the run reported the empty
shelf as a defect. The server was right; the sweep had emptied it.

"It must stay re-runnable" is this sweep's oldest rule, and phase C's own
product helper has restocked since the day it was written. This one had not.

### The answer to the question that started it

**1743 ok · 0 to look at · 0 bugs** once all three were closed, across **19
phases** — with zero throttle waits and zero calls made as nobody. Per-type coverage, from the run's own table rather than from memory:

| shops covered | phases |
|---|---|
| all 8 trading types + `food_restaurant` | B, C |
| 8 (finance has no till) | D E F H I J M N O P Q S T |
| 6 — needs `inventory` | K |
| 5 — trade specials | G |
| 3 — needs a listed shopfront | R |
| 2 — needs `dine_in` | L |

**`finance` is the thin one, and it is thin by construction.** Its only module
is `expenses`, so phase C — which needs a till — skips it, and every phase after
C reads phase C's output. **17 of 19 phases never touch it.** The money screens
themselves are covered, but on other shops; the one type whose entire product IS
the money screens has never been driven end to end. Recorded as a gap, not
fixed.

The nine legacy codes (`restaurant`, `grocery`, `clinic`, `salon`, `workshop`,
`service`, `wholesale`, `books`, `hardware`) are deliberately not swept — *a
sweep of an alias is a sweep of its target with a different label* — and are
covered by `EveryTradeLoadsTest`, which runs every screen for **all 17** codes.

---

## 2026-08-21 — who changed what

### BUG · the trail recorded permissions and not the money they move — NOW FIXED

Eight sensitive acts driven through the API as a shop owner, each one **proven
to have changed something** before its absence from the trail was allowed to
mean anything. Three left a record.

| act | recorded? |
|---|---|
| the discount ceiling on a cashier's discretion | yes |
| a staff permission granted | yes |
| a member of staff suspended | yes |
| a customer's credit limit, Rs 5,000 → Rs 90,000 | **no** |
| a tax rate, which re-rates every product on it | **no** |
| a customer group's discount, every member at once | **no** |
| a coupon — money off every bill quoting it | **no** |
| a product's price | **no** |

Every line in the second half is a money authority, and every line in the first
is proof the shop already believed such things were worth recording.

> **A trail that records permissions and not the money those permissions move is
> a trail about the door, not the room.**

`TaxGroup`'s own docblock states the consequence and has since it was written:
*"edit the rate once and every product on it re-rates."* The difference between
the old rate and the new one is money owed to FBR, and nobody's name was on it.

Fixed with `Auditable::auditOnly()`, an allowlist: `Customer` records
`credit_limit` and nothing else, because a phone number corrected at the counter
is not an event and auditing the record entire would bury the line that matters.
A CREATE counts too — a limit given on day one is the same act as raising it on
day two. `TaxGroup`, `CustomerGroup` and `Coupon` are audited whole; all four are
low-volume, which is the selection rule rather than a coincidence.

### BUG · the shop could not read its own history — NOW FIXED

The only way in was `GET /admin/audit-logs`, behind `role:super_admin`. A shop
owner saw eight rows on their dashboard, with no filter, no date range and no way
to ask a question — while the Help Centre told them, correctly, that the log
records who entered a figure and when.

> **A record that nobody named in it can read is not accountability. It is a
> promise about a filing cabinet in somebody else's office.**

Eighth "built but unreachable" in this codebase, and the first where the thing
out of reach was the shop's own history. `GET /audit-logs` now, tenant-scoped
with an explicit and commented `where` — `AuditLog` carries a `tenant_id` and is
deliberately NOT tenant-scoped as a model, so a read that forgets to say which
shop it wants is the worst possible bug in this particular table.

Gated on `READS_AUDIT` = `settings.manage` **or** `reports.view`. An ANY-of set,
not a single manage permission: **the person most often being asked about is the
one holding `settings.manage`**, and a trail only they can open is not a trail.

### GAP · product prices, deliberately left out

A shop importing five thousand rows would bury its own trail in one afternoon,
and a record nobody can read to the bottom of protects nobody. "Who repriced
this" is a real question that needs a **price history on the product**, not a
bigger list. Said out loud in the Help Centre rather than left to be discovered.

### The regression caught before it shipped

Moving the exclusion filter earlier meant an update whose **only** changed field
is excluded — `password` — would write nothing, where before it wrote a row with
empty values. **That row is the signal.** Losing "somebody's password changed" to
a refactor about credit limits would have been a security regression bought with
a tidier function. The allowlist swallows a values-less change; nothing else
does, and a test pins it in both directions.

### HARNESS · the probe was wrong twice, each time confidently

1. It read `tenant_id` off `/auth/me`, which nests it under `tenant`. The filter
   became `?tenant_id=None` — a non-empty string — so the API filtered on a
   tenant literally called "None" and returned **zero rows**. A probe reporting
   "nothing is recorded" while looking at the wrong shop.
2. It keyed the trail on `(entity, event, entity_id)`. A **second** "User
   updated" for the same user is the same tuple as the first, so it vanished
   into the set — and the probe reported that a permission change left no record,
   **having just watched it leave one.** Keyed on the audit row's own id now.

> **Suspect the detector before the code.** Third time this week.

### HARNESS · `Report.expect` reads a collection `want` as ALTERNATIVES

Phase S walked into it yesterday and phase T today, so the API was the problem
rather than the callers. It turns a comparison of ORDER into nonsense, and makes
an **empty** `want` unsatisfiable — a check that can only ever query, which is
exactly how phase T reported eight correct answers.

Two rules added: an empty `want` is always a caller bug and says so in the row;
and when **both** sides are collections the caller means **equality** ("is this
list one of the acceptable values" would need a list of lists, which nothing
here does).

### Phase T · who changed what

**219 ok · 0 to look at · 0 bugs**, 8 shops. **Always two shops:** `AuditLog` is
not tenant-scoped as a model, so one `where` in one controller is the entire
boundary between one shop's history and another's, and a run with one shop cannot
see that boundary at all.

Four mutations (40–43): the trail forgets, the trail names nobody, two shops are
handed the same row, and the cashier's 403 reads as an answer.

---

## 2026-08-20 — the other half of a date

### BUG · a tyre shop sold its newest stock first — NOW FIXED

Stock can be dated two ways and only one of them was ever read back.

| | expires | ages |
|---|---|---|
| the column | `expiry_date` | `manufactured_on` (a tyre's DOT code) |
| shop-wide worklist | `GET /inventory/expiring` | **nothing** |
| told at the counter | `near_expiry` on every scan | **nothing** |
| sold oldest-first | FEFO, `ORDER BY expiry_date` | **no order at all** |
| the scope for it | `expiringWithin` — two callers | `agedBeyond` — **zero** |

Depletion ordered on `expiry_date IS NULL, expiry_date`. A tyre has no expiry, so
**every lot in a tyre shop tied** and the database returned them in whatever
order it liked — in practice the order they were received. The newest pallet went
out of the door while the 2019 set aged quietly behind it.

`App\Support\DotCode`'s own docblock states the requirement, and has since the
day it was written: *"a shop needs to see the age, **sell the oldest stock
first**, and be warned before a customer notices."* Nothing implemented it.

> **A requirement written in a comment is a requirement nobody implemented.** The
> comment is evidence somebody knew, which is worse than not knowing, because it
> reads as done.

Fixed with `ProductBatch::scopeOldestFirst()` — expiry first (a fence), then
oldest manufactured (a hint), then the undated. One implementation, three
callers, and the third is the reason it is shared rather than fixed in place: the
lot a RETURN goes back into must be the lot the sale took it from, or batch
totals stay right while the shelf goes wrong.

Manufacture date is a **tie-break, never a promotion**: a medicine dying next
week still goes before an older-made lot with a year left on it.

### BUG · the counter was never told, though Settings said it was — NOW FIXED

Settings → POS → Stock ageing: *"Nothing is blocked from sale; **the counter is
told**, and the decision stays with whoever is standing there."* The second half
was true and the first was not — `near_expiry` is permanently null for a tyre, so
the cashier heard nothing at all.

`pos/lookup` now carries `aged` beside it. It names the **oldest** lot, because
that is now the lot the customer is actually handed; naming the newest pallet
while handing over the 2019 set would be worse than silence. Both notices are
branch-scoped through one shared query now — a cashier in Gulberg warned about a
lot on the Johar Town shelf is warned about stock they cannot see, while the lot
they can see goes unmentioned.

### GAP · "which of my lots are old" was unanswerable — NOW BUILT

`GET /inventory/ageing`, plus an Ageing stock panel on Inventory. The badge in
the batch drawer answered *how old is THIS lot*; a tyre shop carrying two hundred
sizes was never going to open two hundred drawers to find out which were old.

`?years=` asks a stricter question than the shop's own policy — a fleet contract,
an insurer — **without changing the shop's policy to ask it.**

### HARNESS · `Report.expect` reads a list `want` as ALTERNATIVES

Phase S passed it a list of expected ROWS, so it asked whether the whole list
equalled one of its own members and **reported the exactly-right answer as
something to look at — 18 times.** Orders are compared as a joined string now; a
set of acceptable values is a different question and this was not it.

### HARNESS · phase C's drawer check assumed a virgin shop

`want = 1000 + cash_taken + 200 − 150` — true only on a shop that had never
traded. This sweep reuses an open shift between runs on purpose, so on a re-run
the expected figure legitimately included earlier takings and the check reported
the shop's **correct** arithmetic as a query.

It measures the **delta** across the movements now (+200 in, −150 out, so +50),
which is the actual claim — *a paid-out must come OFF the expected figure* — and
is true whatever the drawer already held. **A sweep that cries wolf teaches
people to ignore it**, which is worse than the check not existing.

### The scanners could not have found this, and one of them said so wrongly

`dead-rules.py` DID surface `agedBeyond`, and its own `SETTLED` entry answered
the lead: *"a GAP, not a defect: BatchController already publishes age and
age_status per row, so a shop can see which lots are old — it just cannot ask for
only those."* **That judgement was wrong.** It measured the gap as a missing
FILTER and missed that the same unread column meant the wrong tyre left the
shelf. *A dead scope is not only a missing feature — it is a question the code
stopped asking.*

A **"settings nobody reads"** scanner was prototyped and thrown away. All **58
keys** in `ShopSettings::defaults()` have a real reader outside the form that
writes them — measured, not assumed. `stock_age_warn_years` was read, once, for a
badge. The shape here was never "a setting nobody reads" but **a setting read in
one of the several places its own UI copy promised**, and no scanner reads prose.
A tool that reports 0 forever gives false comfort, which is the exact mistake
`dead-rules.py` made on its first day.

`dead-rules.py` now **fails on a stale `SETTLED` entry** rather than printing one
and exiting 0. It had a live entry claiming `agedBeyond` was unwired hours after
it was wired to two call sites, and a stale exception is worse than none because
it is believed.

### HARNESS · phase Q's fuel check GUESSED which product was fuel

Found by the new phase, which is the useful part.

`_a_fuel_product` searched `/products?search=Petrol` and took the first row, then
fell back to **the first product in the whole shop**. Both are guesses. Phase S
created a shelf item with SKU `SWEEP-SHELF-PETROLEUM`; product search reads the
SKU, so it matched a search for "Petrol", sorted newest-first ahead of the real
fuel, and the rate check spent its run trying to reprice a tyre.

The server said so plainly — `422 … isn't held in a tank` — and the harness
reported `UNCLEAR: the check never ran`, which is the third verdict doing exactly
its job. **A mutation aimed at a check that never runs proves nothing.**

Fixed on both sides:

- **A tank names its product.** `_a_fuel_product` asks `/fuel/tanks` now. That is
  the only authority on what fuel is, and asking it makes the check immune to
  every product any future phase invents.
- **Phase S's SKU no longer carries a trade name.** SKUs are unique per TENANT,
  so one neutral name does for every shop.

> **A check that guesses its subject is a check about whatever happens to be
> first.** It had been right by luck for as long as nobody else added a product.

### HARNESS · phase S's own reset could fail without saying so

Each check in phase S states a WHOLE shelf — *"these two lots, and the older one
goes first"* — so it resets the shelf first. The reset zeroed each lot with a
batch-scoped stock adjustment and then deleted the row. **Neither call does what
it looks like it does:**

- a movement with `reference_type: batch` is **exempt from batch accounting by
  design** — those movements reconcile stock TO the lots and must not re-deplete
  them — so the lot kept its quantity;
- deleting a lot that still has stock in it is **refused, 422**, and correctly:
  forty strips of medicine do not vanish, they are binned or they go back to the
  distributor, and `DisposeBatchRequest` makes somebody say which.

Both proven by hand against the live API. **The phase was green before and after
the fix**, so this is not a claim that it was reading wrong shelves — the lots
each check cared about had usually been depleted to zero by the check before,
which is deletable. The point is narrower and worse: **the reset could fail, and
when it failed it said nothing**, so every assertion after it was conditional on
luck nobody was measuring.

Fixed by taking the lot off the shelf the way a shop does — `DELETE` with a
disposition, which writes it off and records the loss. And **the reset now files
a QUERY when it cannot clear**, naming the lot: silence is no longer one of the
outcomes.

> **A setup step that can fail silently turns every check after it into an
> assertion about the wrong world.** Setup is not exempt from the denominator
> rule just because it is not the thing being tested.

### Phase S · the shelf that ages

**233 ok · 0 to look at · 0 bugs.** 8 of 9 shops (finance has no inventory
module, correctly skipped). Not gated on a trade: `dot_code` is accepted on any
lot and `/inventory/ageing` asks the shop rather than the trade, so a trade list
in the phase would be a second copy of an answer the product already has.

Five mutations (35–39). The sharpest is not "no lot moved" — that lie trips half
the phase and proves little. `_lots_answered_backwards` hands the sweep **the
exact wrong answer**: the old lot full and the new one empty, which is precisely
what a shelf sorted on expiry alone did to a tyre shop.

### And two of my own tests passed against the bug

`test_the_oldest_first_rule_is_not_just_insertion_order` creates the old lot
first, so the database's own order gives the right answer by luck — it passes
either way. Its mirror, with the fresh lot created first, is the one with teeth.
**Both are kept** so neither direction can pass by accident.

Every lot helper also wrote `branch_id` null. FEFO matches lots at THIS branch,
so none of them were visible to the depletion under test and four tests failed
for the wrong reason. **Third time this repo has shipped that mistake** — see
`shopos-forecourt-branch` and `shopos-adjust-wrong-branch` — so the helper now
carries a comment saying so.

---

## 2026-08-20 — the ceiling that stopped at the counter

### BUG · a cashier capped at the till was uncapped on a tab — NOW FIXED

Two different questions, and only one of them had travelled.

`discounts.apply` answers **may you discount at all**, and it was checked on the
counter, the dine-in tab and the settlement alike. `max_discount_percent` and
`max_discount_amount` answer **how much**, and they were consulted in exactly one
place: `CreateSaleAction`.

The **cashier** preset holds `discounts.apply` and deliberately withholds
`discounts.override`. So a cashier was capped at the till and **uncapped the
moment the same bill was a table** — the ceiling an owner had set in Settings was
absent from the Floor module.

A second door: `SettleTicketAction` rings its sale with `trusted_prices: true`,
deliberately, because the tab's snapshot *is* the bill and live menu state must
not reprice food already eaten. The counter's ceiling check sits on the untrusted
branch, so a whole-tab discount keyed at settlement went through untouched.

Fixed with `DiscountCeiling::assert()` — one implementation, the same argument
that produced one `ModifierResolver`. Judged on the **whole bill**, not per line:
the counter has always summed every line discount plus the cart discount against
the subtotal, and *ten lines at ten percent give away exactly what one line at a
hundred does*. Voided lines excluded. Still opt-in — both limits default to null.

Four tests in `RestaurantDineInTest`; three were red before the fix, the fourth
("with no ceiling the floor is free as it always was") green before and required
to stay green.

### How it was found · list what each path refuses, read the difference

Not by reading the Floor module. Three places can start selling something — the
counter, an order, a dine-in tab — and each asks a list of questions first.
Before today five of those questions were asked by all three;
`DISCOUNT_LIMIT_EXCEEDED` sat in one column and nowhere else, **next to eighteen
others that legitimately belong to a counter** (khata, points, trade-ins, IMEIs).
The signal was in a column where most rows are correct.

That comparison is now `scripts/one-rule-many-paths.py`. Nine rules are asked by
all three paths; every difference carries a line saying why. **The useful moment
is not the clean run** — it is the day somebody adds a refusal to one path, when
the tool asks whether the other two need it.

### HARNESS · two ways that tool was wrong

**Settlement is not a peer.** Adding `SettleTicketAction` to the compared set
collapsed the intersection to zero. It does not decide whether something may be
sold; it takes money for food already eaten, and re-asking the item rules there
would refuse a bill the shop has already served. What it *does* share is the
giving-away question, so that is asserted by name — the guard must be **called**
by counter, tab and settlement — rather than compared.

**A shared guard must be credited to its callers.** Extracting the ceiling moved
`DISCOUNT_LIMIT_EXCEEDED` out of all three path files, so a per-file scan would
have read the fix as *removing* the rule from everywhere.

Backend **2098 green**.

---

## 2026-08-20 — the grep, kept

`Product::scopeSellableToday()` was found by hand, and the technique is worth
more than the finding. It is now `shopos-backend/scripts/dead-rules.py`: every
method whose **name is a decision** — `is*`, `has*`, `can*`, `requires*` — that
nothing anywhere calls.

**57 such names. Ten uncalled. One a real gap.**

### BUG · a supplier credit could be recorded twice — NOW FIXED

`POST /inventory/disposals/{id}/credit` records what a distributor actually paid
for goods sent back. It checked the permission and the disposition and **never
checked whether a credit had already been recorded**, so a second call silently
replaced a settled money figure and the "to claim" worklist did not reopen.
`StockDisposal::isCredited()` had existed the whole time with no callers — the
model stated the rule and nothing asked it.

*The screen was already right, which is what hid it.* The "Credit received"
button disappears once `credit_received_at` is set, so nobody clicking through
the panel could do it twice. The API is the contract, and a retry or a double
tap on a slow connection is not the panel.

Refused (409 `ALREADY_CREDITED`) rather than kept-first: pressing 86 twice is
the same intent repeated, recording two different amounts is not. The refusal
names what is already on the row. A khata repayment is append-only — a ledger
row per payment — so it has no such problem; this is a single slot, and a single
slot settles once.

### The other nine were fine, and that is the point

Seven were one-line derivations of a field other code reads directly
(`isRequired()` → `min_select > 0`, while `ModifierResolver` reads `min_select`).
Two had the rule enforced **in the query rather than the predicate** —
`OtpService::verify` selects `whereNull(consumed_at)` under a row lock, so an OTP
cannot be replayed even though `isConsumed()` is never called.

So the tool reports **leads, not findings**, and every one carries a line saying
which — including "redundant", because that is the common case. A stale entry
(method gone, or newly called) is reported too, since an exception list that is
believed and wrong is worse than none.

### HARNESS · the scanner was wrong twice, and the second one is the good one

**It read 62 of 74 rules as uncalled.** Its pattern excluded `>` to skip
declarations — which is how PHP calls a method. It reported `isSoldOut()` unused
an hour after it was wired into three call sites. *Suspect the parser before the
code: a detector that finds far more than it should has usually stopped reading
the language.*

**Then it could not find the bug it was built from.** With the credit guard
deliberately removed it still reported nothing — because the controller docblock
explains that `isCredited()` had sat unused, and the test says the same, and both
lines contain `isCredited(`. **Comments out, code in**, the rule
`confirm/native.test.ts` already had to learn: a file that explains the mistake
it stopped making is not making it. `--prove` asserts both by name now, before
it reports anything.

Backend **2094 green**.

---

## 2026-08-20 — nine screens where page two did not exist

The coupon gap recorded below turned out not to be about coupons.

### BUG · thirty-seven endpoints paginate, nine screens could not turn the page — NOW FIXED

Fifteen screens had hand-written the same fifteen lines of Previous/Next. Nine
had written nothing, and on those the rows past the first page were not awkward
to reach — **they could not be reached at all.**

| screen | a page holds | how you reached row 31 |
|---|---|---|
| Owner reviews | **10** | you didn't |
| Notifications | 15 | you didn't |
| Purchase orders | 15 | you didn't |
| Coupons | 30 | you didn't |
| Stock transfers | 20 | you didn't — and the hook took a page, and the service took a page |
| Fuel deliveries / rates / shifts | 15–25 | you didn't — and the hooks already returned `{ rows, pagination }` |
| Customers, suppliers, vehicles, warranty claims | 20–25 | only by knowing the name to search |

Ten a page means a shop with eleven reviews can never read the first one it ever
got, or reply to it. Three screens had the plumbing built the whole way down and
were one argument short at the top — which is the argument for a component:
paging is fifteen lines every screen has to remember, and **a screen that forgot
looks exactly like a screen with no rows to show.**

Fixed with one `<Pager>` (`components/ui/pager`), now used by 24 screens; the
fifteen copies are gone, and they had drifted — `px-5` against `px-6`,
`setPage(page - 1)` against `setPage((p) => p - 1)`, several counting "items"
whatever the rows were. Filters reset to page one, because searching from page
three of the old results shows an empty table that reads as "no matches".
`CouponController::index` gained a search, since a coupon is found by its code
and by nothing else.

### Two smaller things that fell out

Three cards were their own horizontal scroller, so a pager inside them scrolled
sideways out of view with the table — split into a card holding a scroller and a
pager. And `WarrantyLookupPage` carried `title="Close {closing?.product_name}"`;
a quoted JSX attribute is a **string**, so the merchant was shown that text
literally.

### HARNESS · four ways the scanner reported a clean number first

Every one of these produced a plausible report.

1. **It believed a type.** A screen counted as safe if its module mentioned
   `page` anywhere — and `couponsService.list` is typed `{ page?: number }` with
   nothing ever passing one. *Page state that never changes is not paging.*
2. **It lost the route prefixes.** Parsing `routes/api.php` by regex dropped
   every `Route::prefix(...)`, storing `transfers` where the URI is
   `inventory/transfers`. Eight routes matched nothing, their screens were never
   checked, and the report said "1 of 12" and looked healthy. Fixed by asking
   Laravel: `php artisan route:list --json`.
3. **It matched prefixes, not paths.** `/products/{id}/branch-prices` counted as
   listing `/products`.
4. **It could not tell a link from a fetch.** `to="/admin/tenants"` is
   navigation; matching any slash-string accused the dashboard of failing to
   page lists it merely links to.

And one about its own unit: judging each folder alone reported the notification
bell broken **after it was fixed**, because the bell fetches in
`modules/notifications` and renders in `components/header`. The fix is two texts
for two questions — *what a folder lists* from its own source, *whether it can
reach* from its source plus one hop of importers. Fold importers into the first
and `components/ui` gets credited with listing the tenant directory, because
every admin page imports a Button from it.

`--prove` blinds the detector and requires the result to LOOK blind: zero
folders judged, every route unplaced. **A scan that reads nothing reports "0
problems", which is character for character what a clean sweep reports.**

### Where it stands

`0 of 23` folders stuck. Two paginating routes are named by no panel screen —
both the public storefront, consumed by the customer app; printed rather than
filtered, because a route nothing lists is either an unbuilt screen or a path
the scan failed to recognise and those look identical from inside.

Backend **2093 green**, panel **1022 green**.

---

## 2026-08-20 — the dish, and the button only the till obeyed

Phase R gained the two things a food shop does that nothing had ever driven from
the customer's side: **a dish ordered with choices on it**, and **an item the
kitchen has taken off tonight's menu**. The first found nothing. The second
found a defect in three places at once.

### BUG · sold out at the counter, on sale in the app — NOW FIXED

`sold_out_at` — "eighty-six the fish" — has its own column, its own controller,
its own button and eight tests. **All eight ask the till.**

The question a shop actually asks is *may this be sold right now*, and three
places can start selling an item:

| path | what it did |
|---|---|
| `CreateSaleAction` — the counter | refused, `ITEM_SOLD_OUT` |
| `OrderService::place` — the app, and the phone | **took the order** |
| `AddTicketItemsAction` — the dine-in tab | **printed the kitchen ticket** |

So the cook presses 86, the till stops offering the fish, and the delivery app
keeps taking orders for it all evening while a waiter puts it on table six.

**What makes it worse than an omission.** `CreateSaleAction` *deliberately
exempts* the trusted path from this rule and says why — an online order is food
the customer already committed to, and refusing to bill it because the kitchen
has since run out is a shop that cannot close its own tab. That reasoning is
right, and it is only safe **if placement refused first**. Placement never did,
so for an online order the rule was enforced at neither end.

*A comment that assumes another path did the work is a dependency, and an
unchecked dependency is a hope.*

Fixed in all three: `OrderService::place` refuses (marketplace and phone alike —
`visible_in_marketplace` is relaxed for a shopkeeper on the phone because
publishing is their business, but running out is not a publishing decision),
`AddTicketItemsAction` refuses unconditionally, and
`MarketplaceController::publicProduct` now publishes `sold_out` so the storefront
can grey the item out instead of letting the customer find out at checkout.
An order placed **before** the press still completes, which is the whole reason
the exemption exists and now has a test holding it down.

### How it was found · a scope with no callers

Not by a test, and not by reading `SoldOutController`. By noticing that
`Product::scopeSellableToday()` had **one definition and zero callers**.

*A scope nobody calls is a rule nobody enforces.* Worth grepping for on any flag
that matters.

### Clean · the dish ordered with choices on it

Eight checks, nothing wrong. `ModifierResolver` is deliberately one
implementation shared by the POS and the online order, and shared code diverges
in what it is HANDED rather than in what it does — which is why the checks drive
it from outside rather than testing its arithmetic.

The menu publishes the groups, their `min_select` and each option's
`price_delta`; a stuffed crust and extra cheese cost the shop's own +200 and
+100 on a customer who sent option ids and never a number; the order line keeps
the snapshot; a required group cannot be skipped, a group's limit holds, and an
option belonging to a **different dish** is refused. Each refusal is required to
name the rule it enforced — a 422 for having no stock reads exactly like a 422
for needing a crust, which is the mistake the prescription check made first.

The completion hop was driven too, and it was the interesting one: a completed
order rings its sale down the `trusted_prices` branch, which carries the captured
price forward instead of asking the resolver again. Re-running it would add the
+300 twice, or reject an order the shop has already cooked. It does neither —
the customer agreed to 1100 and the till rings 1100, snapshot intact.

### QUERY · the other scope with no callers

Grepping every `scope*` in `app/Models` for callers turned up **two of thirteen**
with none:

- `Product::sellableToday()` — the bug above.
- `ProductBatch::agedBeyond($years)` — *"lots at or past the warning age with
  stock still on them — the shelf sweep a shop does before a customer does it
  for them."*

The second is a gap rather than a defect: `BatchController` already publishes
`age` and `age_status` per row, so a tyre shop **can** see which lots are old —
there is just no way to ask for only those, though the sibling filter
(`expiringWithin`) is wired and exposed. For a shop with hundreds of lots that
is the difference between a shelf sweep and scrolling.

Worth more than the one filter: **PHP has no equivalent of the panel's
`reachable.test.ts`.** That guard exists precisely because this repo has shipped
"built but unreachable" seven times, and it only watches TypeScript.

### HARNESS · the sweep built its own haystack and then lost the needle

The full run came back **1583 ok · 1 to look at · 0 bugs**, and the one query was
phase M: *"mart · a coupon to redeem — could not create one."*

`_coupon()` read the **first page** of `/coupons` looking for `SWEEP10` and
created it if absent. That worked for thirty-one runs. Then:

- `/coupons` paginates at 30 and has **no search parameter at all**, newest
  first;
- the single-use check on the same page creates a **fresh random code every
  run** — deliberately and rightly, because a fixed one is spent on run one and
  the first-use half stops being exercised;
- nothing ever deleted them. Thirty-two piled up, `SWEEP10` sank onto page two,
  the scan found nothing, the create was refused as a duplicate, and the phase
  reported it could not make a coupon **it had made thirty-two runs earlier**.

> **A lookup that depends on WHERE a row sits is not a lookup.**

Fixed both ends: `_coupon()` now creates first — the only way to be certain —
and on refusal asks `/coupons/validate`, the one endpoint that takes a code
instead of a page. And the single-use check deletes its throwaway afterwards, so
the *new code each run* property stays without the litter that broke it. The
sale keeps `coupon_code` as plain text, so the record of the redemption survives
the delete. Phase M: **251 ok, 0 queries**, and the shop's coupon count is flat.

### QUERY · what that exposed on the real screen

`CouponController::index()` is `paginate(30)` with no filter, and the panel's
`useCoupons()` requests no page and renders whatever comes back — there is no
search box, no paging control, no "load more".

**A shop with more than 30 coupons cannot reach the rest at all** — cannot
deactivate one, cannot edit its expiry, cannot delete it. Thirty is not many for
a shop that runs WhatsApp campaigns. Not fixed here; recorded so it is a
decision rather than an oversight.

### Where it stands

**18 phases · 1583 ok · 0 bugs · 36 of 36 mutations caught.** Phase R alone is
204 checks. Backend 2091 green, panel 1017 green.

---

## 2026-08-20 — phase R · the customer, driven for the first time

Seventeen phases and 1,683 checks, all of them as somebody who **works at the
shop**. Phase R is the first to hold a `role:customer` token.

### Clean · 185 checks across three shops, 0 bugs, 0 queries

The customer surface holds: the order prices itself from the shop's catalog, a
price sent by the customer is ignored, an order naming one shop and carrying
another shop's product is refused (422), and every ownership probe — read
another customer's order, cancel it, edit their address, delete it — comes back
404.

**Why that is trustworthy: both new mutations are caught.** Pretend every order
was accepted → the sweep reports `AN ORDER REACHED INTO ANOTHER SHOP`. Answer
200 to any customer asking for any order → `ANOTHER CUSTOMER READ THIS ORDER`.
**29 of 29 mutations sweep-wide**, the third being a prescription-only medicine
accepted online.

### QUESTION ASKED FOR THE FIRST TIME · a prescription on a phone

Nothing in the sweep had ever set `requires_prescription`, let alone tried to
buy one. A stranger ordering a scheduled medicine for delivery, with **no
prescription field anywhere on the request** and nobody at a counter to look at
the paper, is refused: `RX_IN_PERSON_ONLY`.

**And the first version of that check would have passed either way.** It read
only the status, and the medicine it created sat at `stock_quantity: 0.000` — so
a 422 for having none reads exactly like a 422 for needing a prescription, and
the check would have gone green having tested the stock rule. Fixed by stocking
the shelf first so the other rule cannot fire, and by requiring the refusal to
NAME the prescription. **A refusal is not enough; it has to be a refusal about
the thing being tested.**

Coverage went `R  1` → `R  3` (mart, food_restaurant, pharmacy): the phase now
opens a shop for shoppers itself — the `marketplace` module with the admin
token, `setup_completed` with the owner's — and reports which switch refused
when one does.

### HARNESS · two, before the phase could say anything true

1. **A 404 read as access.** The role fence pointed at `/reports/sales`, which
   does not exist. The check saw "not 401 or 403" and reported *A CUSTOMER CAN
   READ THE SHOP'S TAKINGS*. **404 is "no such route", not a refusal** — the
   same mistake phase I made reading 403 as a permission failure when it was
   `MODULE_DISABLED`.
2. **The most valuable check quietly did not run.** The cross-shop probe looked
   for a second shop among the ones a customer can SEE — one of eight is listed
   on the marketplace — found none, and reported "no second shop to borrow
   from". The denominator printed `shops a customer can reach — 1 of 8` directly
   above it, which is the only reason it was obvious. It borrows from ANY shop
   the sweep built now: **a shop being invisible to shoppers makes its products
   a better probe, not a worse one.**

---

## 2026-08-19 — offline selling, driven in a real browser

Not a sweep run. `e2e/selling.spec.ts`: a cash sale rung through the screen, and
the same thing with `context.setOffline(true)`. Neither had ever been done.

### BUG · a refused offline sale showed the cashier nothing

`checkout.error instanceof ApiError` gated the tender panel's only error
message. `OfflineRefused extends Error`. Pressing **Complete sale** with the line
down produced no spinner, no message and no sale — a dead button with a customer
at the counter. The refusal text existed and was good; nothing rendered it.

### BUG · the queue drained and the badge said it had not

Row `pending → acked` with `INV-000918` **8 seconds** after the line returned.
Pill: **"1 still to send"**, a minute later and onward. `pendingCount()` was
correct and simply never re-run — deps `[enabled, connected]`, neither of which
moves when a flush finishes. Recount now hangs off the `syncing` transition.

### BUG · the till could lock itself out of its own shop

Unlock is HTTP; the PIN is only on the server (right — a mirrored PIN is
readable by whoever holds the tablet). So an idle lock during an outage was a
shutter, and the "sign in with a password instead" escape signs the till OUT
through that same server. Idle lock gated on the connection; hand-over disabled
offline with a reason; an already-locked till told which door is shut; the
sign-out escape shut while offline.

### BUG · the Reports page scrolled sideways on a tablet held landscape

`1115px of content in a 1080px window; widest is div.apexcharts-canvas`.

ApexCharts writes an **inline pixel width** onto its canvas from whatever the
parent measured at mount, and re-measures on `window.resize` **and nothing
else**. This app has several ways for a container to get narrower without the
window changing — the sidebar rail collapses below `xl`, a drawer opens, a
filter row wraps — and each leaves the canvas at its old, larger width. The page
then scrolls sideways to accommodate a chart, which is how a Close button ends
up somewhere nobody can reach.

Fixed with `useFitsItsBox`: a ResizeObserver on the chart's own box, handing the
measured width to the chart. The box is watched, not the window.

**Not swept up:** nine other `react-apexcharts` call sites share the pattern and
are currently passing. The hook is there for them.

### BUG · two ways an offline slip number could deadlock a till — NOW FIXED

Found because the browser suite hit it: the server refused a queued sale with
`Duplicate entry '<tenant>-OFF-TILL-001D-000001' for key
'sales_tenant_offline_number_unique'`, and the till retried it for ever behind
the message *"This sale could not be recorded. It is still safe on the till."*
It is safe, and it can never leave. **That is money stranded on a device.**

The slip is `OFF-<register>-<4 chars of device id>-<6-digit counter>`, and the
two halves live in **different storage layers**:

| part | lives in | survives |
|---|---|---|
| device id | localStorage | eviction of IndexedDB |
| counter | IndexedDB (`receiptCounter`) | — |

1. **Eviction resets the counter but not the id.** This codebase already warns
   about eviction (`StorageWarning`, `persist.ts`). If IndexedDB goes and
   localStorage stays, the counter restarts at 1 under the same device segment
   and **every offline sale from then on collides with one already recorded**.
2. **`DEVICE_SEGMENT = 4`** — 65,536 values. Two tills in one tenant sharing a
   segment collide from their first sale each. For a 50-till chain that is
   roughly a 2% chance, and the failure is silent and permanent.

**Fixed, all three parts, and the slip's SHAPE never changed** — four characters
in the device segment before and after. Only the guarantee behind them did.

1. **A label may never cost a sale.** The operation id is already the
   idempotency key and is checked first, so if THAT is new the sale is new.
   `PosSyncController` now records it under a disambiguated label (`…-D2`) and
   reports the collision to the shop, instead of dying on the unique index and
   being caught as "something unexpected, retry later". The printed number stays
   the stem, so `Sale::search`'s LIKE still finds the sale from what is on the
   customer's slip.
2. **The counter cannot go backwards.** New `sales.offline_seq` — the sequence
   as a NUMBER beside the label, because the label now has a `-D2` form that a
   SQL parse of the string would get wrong. The catalog pull answers
   `offline_sequence` for the asking device and `nextSequence()` takes
   `max(local, server) + 1`.
3. **The device segment is allocated, not guessed.** New `pos_devices.code`,
   four characters, unique per tenant, handed out once at registration and never
   changed under a till that has already printed it. The alphabet omits `O 0 I 1
   S 5` — somebody reads that code down a phone when they ring about a refund —
   and it is random rather than sequential, so one slip does not reveal how many
   tills a shop runs. A till that has never reached the server still falls back
   to slicing its own id, which is no worse than what it always did.

### HARNESS · six

1. **`expect(after.length).toBe(before.length + 1)` against a PAGED endpoint.**
   `/sales` returns 50. Past 50 sales the length never changes, so the check
   said "the queue never drained" for ever about a queue that drained in 8s.
2. **A leaf-only text scan** cannot see `<button><span dot/>Offline</button>`.
   The offline-indicator rule reported silence while "Offline" sat on screen in
   red. Ask each element for its **own** text nodes.
3. **`offline_selling` is a platform GRANT**, not a shop setting — a plan limit
   published on the catalog envelope beside `offline_days`. A fixture that
   assumed otherwise tests the refusal while claiming to test offline selling.
4. **`useKeepInSync.test.tsx` mocked `pendingCount: async () => 0`** — a
   constant. A stale count was **unobservable by construction**.
5. `reuseExistingServer: true` serves a stale build; and Playwright's `request`
   fixture is NOT taken offline with the page — which is what proves the server
   did not receive the sale while the till was offline.
6. **Four browser projects shared one device id** (it lives in the saved
   localStorage) while each got a fresh IndexedDB, so every project after the
   first restarted its slip counter at `000001` and was refused. The fixture now
   stamps one per project — and, because only FOUR characters of it reach the
   slip, one whose first four characters differ, or "tablet-landscape" and
   "tablet-portrait" would both come out `TABL` and collide exactly as before.

---

## 2026-08-19 — the screens, second pass · the cart that hid its own lines

A shop report, not a sweep finding: **"i add 8,9 rows cart / on mobile and
tablet showing 6,7 / last wali rows hide ho rhi nichee"**.

### BUG · 188px of the cart lay outside the card, unreachable

`min-h-[19rem]` on the cart's `flex-1 overflow-y-auto` scroller, inside an
`overflow-hidden` card. The child will not shrink, the parent will not grow, and
the difference is **cut off rather than scrolled** — with `overflow: hidden`
there is no gesture that reaches it. Phone (390×664): cart pane **128px**, floor
**304px**, so **188px outside**. Nine lines in, **three** visible.

The floor existed so a short basket would not make the payment bar jump. **That
bar had moved out of this card**; the floor was holding nothing up.

### Two layout changes measured out of the same probe

| | before | after |
|---|---|---|
| phone money bar | 248px | **177px** (total + Tender side by side below `md`) |
| phone cart row | 73px (8 cols wrapping onto 3 lines) | **49px** (`Disc`/`Tax` on the item's sub-line when non-zero) |
| phone panes | catalog + cart, ~100px each | **one at a time**, behind a Products / Cart switch below `sm` |
| tablet portrait | 7 of 9 lines | **8 of 9**, ninth a flick away, nothing clipped |

### HARNESS · four, and the third is the one that matters

1. **The fixture had 5 sellable products** — a nine-line cart was impossible.
   Caught only by `expect(available).toBeGreaterThan(7)`. The shelf is now built
   explicitly in `e2e/shelf.setup.ts`.
2. **A stale preview server.** `reuseExistingServer: true` served the previous
   build, so a newly-added `data-cart-row` hook did not exist and the cart read
   as empty. **Rebuild before believing an e2e result.**
3. **`scrollIntoViewIfNeeded` scrolls `overflow: hidden` boxes.** A finger does
   not. The check scrolled the last row into view, asked "visible?", and was
   told **yes** about content the shop can never see. Fixed with
   `onlyWhatAFingerCanReach()` — any scroll on a box that cannot be scrolled by
   hand is put back before measuring. *A reachability check that reaches by
   means the user does not have is not a reachability check.*
4. **`overflow-x-auto` computes `overflow-y: auto`.** CSS forces the other axis
   out of `visible` once either leaves it, so the row's horizontal wrapper
   looked like the cart's scroller and swallowed the scroll. Ask
   `scrollHeight > clientHeight` as well.

Plus one stale rule: `posChrome.test.ts` pinned the tile skeleton by
`bg-white/[0.16]` and `bg-black/25` — tints the tiles stopped wearing when they
became solid cards — so it reported "no tile skeleton" instead of the thing it
is about. **A rule keyed to a colour expires the next time anyone paints.**

New browser rules: `scrollersCanReachTheirEnd` (a scroll container clipped by an
ancestor has content you can scroll to and never see, measured **at rest**) and
`a full cart shows every line a cashier put in it`.

---

## 2026-08-19 — eleventh run · phase Q, and two things a forecourt loses money on

**Three subjects nothing had ever driven. Two of them were broken.**

### THE RATE — tomorrow's price on tonight's petrol

A price notification takes effect at **midnight**, and every station enters it
when the fax comes, hours before. The request that carries the field says so
where it is declared: *"Notifications usually take effect at midnight, so the
rate may be logged before it applies."*

`ChangeFuelPriceAction` ignored it and wrote the new price onto the product
unconditionally. A station entering tomorrow's rate at 8pm **repriced its pumps
at 8pm** — every litre sold that night at the wrong rate, on the one night of
the month when a forecourt is busiest, with nothing erroring anywhere.

Fixed: recording and applying are two events, so `applied_at` joins
`effective_at`, and `fuel:apply-rates` moves due prices every five minutes
beside `reservations:expire`. Three tests; the command is idempotent, so a rate
somebody has since corrected by hand is not reinstated every five minutes for
ever.

### THE RECEIPT — a reprint that never left the tray

The tray is *"every failed print with no later successful one for the same
sale"*, and it compared `printed_at`, which is a **second-precision** timestamp.
A reprint inside the same second — a till retrying, a fallback to the second
printer — **ties** rather than exceeds, so the receipt stayed in the tray after
it had come out. For ever. A tray that never empties buries the one receipt
that really is missing under fifty that were sorted out hours ago.

Fixed by keying on `copy_no`, which is the sequence itself and has no precision
to lose.

**And the test was written around it.** `test_a_later_good_print_clears_the_tray_by_itself`
carried `$this->travel(1)->seconds()` before the retry — one line that was the
whole difference between a passing test and a working feature. Nothing arranges
a spare second at a counter. It is gone, and the test now fails against the old
query.

### THE TANKER — this one was right

A station is billed for what the invoice says and receives what the dip says.
Billed 5,000, dipped 4,950: the tank gains 4,950 and the shortage is 50. Correct
on every check.

### What the sweep got wrong first

Four findings; two were the harness, in the same shape as always.

- **"The catalog export contains none of the shop's products."** The file opens
  with a **BOM**, deliberately — without it Excel reads Pakistani product names
  as mojibake — so `csv.DictReader` keys the first column `"\ufeffName"` and
  every lookup for `Name` missed.
- **`api.py` truncated the body to 400 characters.** That field is a preview for
  putting in a finding without printing a megabyte; read as the response it
  showed a header row and nothing else.
- **The print trail is `orderBy('copy_no')` ASCENDING**, so row zero is the
  ORIGINAL. Reading it as "the latest print" meant the check marked the original
  failed, reprinted, and then looked at the original again to see whether the
  reprint had worked.
- **The mutation that did not mutate.** The tanker mutation only WATCHED the
  delivery go past and changed nothing, so the check passed and the harness
  nearly called it caught. Then the two fuel mutations came back UNCLEAR — the
  runner never builds a forecourt, so `/fuel/tanks` was empty and the checks
  never ran at all. Both are the denominator doing its job.

### Where it stands

**17 phases · 1,683 checks · 26 mutations · 55 harness findings, 8 product bugs.**

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

**All phases through R are built.** What is worth doing next:

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
