# The cross-type QA sweep

**What this is.** A systematic pass over the whole product, one business type at
a time, driven by an engineer rather than a tester. Its job is to find the bugs
that only appear when modules meet each other — a sale that moves stock, an
expense that hits the drawer, a purchase that moves the cost price — and the
ones that only appear in one trade.

**What this is not.** [`ShopOS-QA-Testing-Guide.md`](ShopOS-QA-Testing-Guide.md)
is for a human testing *one shop* through the screens. This runs *every* shop
type through the API, so a whole trade can be exercised in seconds and re-run
after every fix. The two find different things and neither replaces the other.

> **Findings live in [`FINDINGS.md`](FINDINGS.md)**, newest first, each with the
> exact call that produced it. Anything fixed gets a test in the suite that
> fails without the fix — a finding with no test is a finding that comes back.

---

## The order, and why it is the order

Each phase needs what the phase before it built. Running them out of order
produces failures that are not bugs, which is the fastest way to lose trust in a
sweep.

| Phase | What it covers | Needs | State |
|---|---|---|---|
| **A** | Admin side — plans, tenants, modules, limits, billing | nothing | **built · clean** |
| **B** | Per-trade setup — settings, catalog shape, units, item types | A | **built · clean** |
| **C** | Selling — POS, tenders, returns, held tickets, shifts | B | **built · clean** |
| **D** | Stock — receive, adjust, transfer, disposal, and what selling did to it | C | **built · clean** |
| **E** | Money — expenses, income, drawer, ledger, khata, reports | C | **built · clean** |
| **F** | The seams — where two modules meet | D + E | **built · clean** |
| **G** | Trade depth — the things only one trade has | F | **built · clean** |
| **H** | Offline — the till with no server | G | **built · clean** |
| **I** | Who is at the counter — job presets, and three lanes at once | C | **built · clean** |
| **J** | The Expense Manager and its wire to the drawer | C | **built · clean** |
| **K** | More than one branch — separate shelves, transfers, the HQ view | C | **built · clean** |
| **L** | The floor — tabs, the pass, split bills, whose table it is | C | **built · clean** |
| **M** | Money given away on purpose — points, coupons, promotions | C | **built · clean** |
| **N** | Sales that are not a sale yet — layaway, exchange, trade-in, disposals | C | **built · clean** |

**Eighteen phases built. 36 of 36 mutations caught.**

Phases A–H answer "does the shop work". The rest answer what they could not,
and two of them are where a real defect turned out to live:

- **I** — every earlier phase ran as the OWNER, who passes every gate. The
  permission system had never been asked a question it could fail.
- **J** — a shop's money moves through the ledger *and* the physical drawer, and
  an entry landing in one but not the other is invisible until the count.
- **K** — nothing goes wrong with multi-branch except this: a quantity read
  without asking where it was.
- **L** — a restaurant's till is the last thing to hear what happened; between
  the order and the money there is a tab that has to survive everything.
- **M** — points, coupons and promotions are one thing wearing three hats, and
  they fail the same two ways: given twice, or not given at all.
- **N** — every phase before it rang a bill and took the money in one movement.
  These are the shapes where those two moments come apart: an advance against
  goods the shop still owns, a return and a sale bolted together, goods handed
  across the counter as payment, and stock that left without being sold.

Two product defects so far — [the forecourt nobody could
start](../decisions/shopos-forecourt-branch.md) (phase G) and [the stock
correction that landed at the wrong shop](../decisions/shopos-adjust-wrong-branch.md)
(phase K) — against **42** findings that turned out to be the sweep itself. That
ratio is the most useful thing this document can tell you: **verify before
believing, because the base rate says it is the tool.**
See [`FINDINGS.md`](FINDINGS.md).

Both defects are the same shape, which is worth naming: **one question, answered
differently by two paths.** A tank stored `branch_id: null` while the shift
looked for Main; a stock adjustment wrote to Main while the panel said which
branch you were standing in. Neither errored. Both had a thorough test suite
sitting right next to them that never asked.

**The most dangerous harness bug found so far** is worth reading before you
trust any refusal this sweep reports. A staff sign-in that failed on the login
throttle returned `None`, and the client fell back to the *ambient* token — so a
permission probe ran as the admin, got a **401**, and the check read that as the
**403** it was hoping for. A refusal that proves nothing, printed as a pass.
There is now an explicit `NOBODY` sentinel, and a 401 inside a permission probe
is reported rather than counted. When a check asserts that something is refused,
make sure it is refused *for the reason you think*.

---

## Phase A — the admin side

The platform console, before any shop exists. Everything here is done as
`admin@shopos.test`.

### A1 · Plans
- [ ] Create a plan; PKR only, no other currency renders
- [ ] Edit its price; existing tenants keep what they were sold
- [ ] Delete a plan that a tenant is on → must refuse, not orphan
- [ ] Limits on a plan: products, storage, branches, staff, registers

### A2 · Creating a tenant
- [ ] Create one per business type (8) — see the table in Phase B
- [ ] The module map offered matches the type's defaults
- [ ] Modules can be overridden at creation and the override sticks
- [ ] Branch / staff / register limits assigned at creation are enforced later
- [ ] The owner user is created and can log in

### A3 · Module toggles after creation
- [ ] Turn a module OFF on a live tenant → its screens disappear for that shop
- [ ] Turn it back ON → screens return, data still there
- [ ] A module the trade does not propose can still be granted
- [ ] `useMe()` refresh: the shop sees the change without re-login

### A4 · Limits and billing
- [ ] Raise the register limit past 2 (the default) and create Lane 3
- [ ] Hit the product limit → refused with a readable reason
- [ ] Billing filters: paid / unpaid / grace / suspended
- [ ] Suspend a tenant → its users are locked out, its data is not deleted
- [ ] Offline selling: grant, withdraw, and the till obeys within one pull

### A5 · Security
- [ ] A tenant user cannot reach any `/admin/*` route
- [ ] A tenant cannot read another tenant's anything (spot-check 5 endpoints)
- [ ] An admin with a narrow permission set gets 403, not a blank screen
- [ ] Password reset works for both an admin and a shop owner

---

## Phase B — per-trade setup

Run every later phase **once per type**. These eight are the primary codes;
the nine legacy codes resolve into them and are not separately tested.

| Type | The shop it stands for | The thing only it has |
|---|---|---|
| `food` | restaurant, cafe, bakery | dine-in, tables, KOT, recipes |
| `mart` | grocery, supermarket | weight items, scale barcodes, packs |
| `pharmacy` | medical store | batches, expiry, FEFO, prescriptions |
| `retail` | clothing, electronics | variants, serials/IMEI, warranty |
| `services` | salon, studio | service items, no stock |
| `automotive` | workshop, tyre shop | vehicles, trade-in, job cards |
| `finance` | books, ledgers | income/expense only, no catalog |
| `petroleum` | fuel station | nozzles, dips, tank stock, shifts |

### For each type
- [ ] Complete setup: name, city, location, business hours
- [ ] Settings tabs shown match the module map (a missing tab is usually correct)
- [ ] Units offered match the trade (`pharmacy` → Strip; `mart` → KG)
- [ ] Variant attributes match the trade (`retail` → Size/Color)
- [ ] Item types offered match trade × modules — **not the trade alone**
- [ ] Add a product of each item type the trade allows
- [ ] Add a category, a brand, a collection; check each filters the catalog
- [ ] Barcode: assign, scan-lookup, and a pack barcode preselecting its pack

---

## Phase C — selling

- [ ] Open a shift; the float is recorded
- [ ] Ring a sale: tiles and rows, search, barcode, quick keys
- [ ] Every tender the trade allows: cash, card, bank, split, khata
- [ ] Change due, cash rounding, discount within the ceiling
- [ ] Discount over the ceiling → refused with the ceiling named
- [ ] Hold a ticket, recall it on the same lane, and on another lane
- [ ] Return part of a sale; return all of it; refund lands where it should
- [ ] Exchange: one movement, difference settled once
- [ ] Void a whole sale → stock returns, money reverses
- [ ] Receipt prints; reprint prints the same thing
- [ ] Close the shift: counted cash, denominations, variance, Z-read

---

## Phase D — stock

- [ ] Receive a purchase order → stock rises, cost price moves (weighted avg)
- [ ] Adjust stock up and down with a reason
- [ ] Transfer between branches → out of one, into the other, never both
- [ ] Dispose (write off) vs return to supplier — **never summed together**
- [ ] Sell → stock falls by exactly the quantity, in base units
- [ ] Sell a pack of 12 → stock falls by 12, not 1
- [ ] Sell a combo → every component falls
- [ ] Cancel that sale → every component returns. **Historic P0 lived here.**
- [ ] Low-stock and reorder lists show the right rows, per branch

---

## Phase E — money

- [ ] Record an expense; category, receipt, recurring, budget
- [ ] An expense paid from the drawer moves the drawer
- [ ] Record income; recurring income posts itself when due
- [ ] Khata: sell on credit, take a repayment, statement adds up
- [ ] Ledger and cashbook agree with each other **for the same branch**
- [ ] Profit includes income, not just sales
- [ ] Tax year (1 Jul – 30 Jun) sits beside the calendar year everywhere

---

## Phase F — the seams

Where two modules meet. Most real bugs have lived here, so every line is a
question about **two** things agreeing.

- [ ] Sale → stock → reorder list → purchase order → receive → cost price
- [ ] Purchase received → supplier payable → payment → drawer
- [ ] Sale on credit → customer balance → repayment → drawer → ledger
- [ ] Void a sale that had a promotion, a coupon, and a loyalty award
- [ ] Delete a product that has sales → history keeps its snapshot
- [ ] Delete a category that has products → products survive
- [ ] Rename a branch / register mid-shift → figures stay attached
- [ ] Turn a module OFF that has data → data survives, screens hide
- [ ] Two branches: does every money screen take the branch scope?
- [ ] Two lanes open at once: neither drawer sees the other's cash

---

## Phase G — trade depth

Only the trade that has it.

- **food** — table, tab, KOT, split settle, recipe cost from ingredients
- **mart** — scale barcode, weight item, pack pricing, sold-out/86
- **pharmacy** — batch with expiry (required), FEFO picking, near-expiry alert
  **once per lot per stage**, prescription capture
- **retail** — variant matrix, serial/IMEI capture at sale, warranty lookup
- **automotive** — vehicle record, trade-in **as a tender not a discount**, DOT
  tyre dating = age not expiry
- **petroleum** — nozzle readings, meter roll-over, test litres, full-dip rule
- **finance** — no catalog at all; income/expense/ledger only
- **services** — a service item takes no stock and cannot be received

---

## Phase H — offline

Needs the **built** app (`npm run build && npm run preview`, port 4173) and a
shop that has been granted offline selling. Go offline with **DevTools →
Network → Offline**, never by turning wifi off.

- [ ] Sell offline; the slip prints `OFF-…`
- [ ] **Reload the page while offline** → the shift survives, selling continues
- [ ] Open a shift with no server at all
- [ ] Cash in / cash out offline
- [ ] Close the drawer offline
- [ ] Hold and recall a ticket offline
- [ ] Refusals arrive **before** the drawer opens, each with a reason: khata,
      loyalty redeem, coupon, dine-in, bank offer, member discount %
- [ ] A medicine / serialised item is refused offline, by name
- [ ] Reconnect: opens sync, then sales, then the close — in that order
- [ ] Search the `OFF-…` slip number and find the sale
- [ ] Reports → Offline shows what came in late and every violation

---

## Phase O — the two tickets that are not a sale

A parked basket and a phone order are both a claim on stock nobody has paid for,
and they fail in **opposite** directions. Do these on a real screen; the API
sweep covers the arithmetic but never the till in somebody's hands.

- [ ] Park a basket → the shelf figure does not move
- [ ] The parked ticket is on the held list, with its label
- [ ] Resume it → the cart comes back with every line
- [ ] **Two lanes, one ticket**: open the held list on both, resume on lane 1,
      then resume on lane 2 → lane 2 is refused, and says why
- [ ] Bin a parked ticket → gone, and still no stock moved
- [ ] Take a phone order → the shelf drops by what was ordered
- [ ] Cancel it → the shelf goes back to exactly where it was, once
- [ ] A cancelled order cannot then be completed
- [ ] Assign a rider; the order shows who is carrying it

---

## Phase P — the day

A shift close counts one drawer. A **day close** counts the shop, and it is the
last thing anyone does before going home.

**Closing a day cannot be undone.** Do this on a test shop, or on a branch you
are willing to close off.

- [ ] The day screen shows every shift, including the ones still open
- [ ] A cashier cannot close the day
- [ ] The day refuses to close while any drawer is still open, and names it
- [ ] Close every drawer, close the day → its float, cash sales and cash in are
      the shifts' figures added up
- [ ] Closing again is refused
- [ ] Record a deposit → it lands on the day the counter is trading
- [ ] **Leave a day open overnight**, trade the next morning, bank something →
      the money lands on TODAY, not on the day nobody closed

---

## Phase Q — the paper, the tanker and the rate

Three things a shop loses money on without anything erroring.

- [ ] Print a receipt, tell the till it failed → it is in the reprint tray
- [ ] Reprint it → it **leaves** the tray, immediately, not a minute later
- [ ] Record a delivery billed 5,000 with a dip showing 4,950 → the tank gains
      **4,950** and the shortage reads 50
- [ ] Enter tomorrow's rate this evening → **the pumps do not move**
- [ ] A litre sold tonight is still tonight's price
- [ ] After midnight (or `php artisan fuel:apply-rates`) the new rate is live
- [ ] Correct a fuel price by hand afterwards → the scheduler does **not** undo it
- [ ] Export the catalog → it opens in Excel with the names readable, and every
      product is in it

---

## Running it

The API harness lives at `docs/qa/sweep/` and drives the flows against
`http://localhost:8000` with a seeded tenant per type. It is deliberately not a
test suite: it is a **sweep** that reports what it saw, so a surprising answer
is something to look at rather than a red build.

```bash
cd shopos-backend && php artisan serve --port=8000
cd docs/qa/sweep
python3 run.py            # every phase, in order
python3 run.py a b        # just those
python3 mutate.py         # prove the sweep can still fail
```

## Phase R — the customer

The first phase that is not somebody who works at the shop. It holds a
`role:customer` token and drives `/marketplace/*` and `/customer/*`.

```bash
python3 run.py r          # pulls a, b, c in first
```

It asks five things:

- **The order prices itself.** A customer names products and quantities, never a
  price. A price sent anyway must be ignored or refused.
- **The boundary.** `shop_slug` and `items.*.product_id` arrive in one body with
  nothing tying them together. An order naming one shop and carrying another
  shop's product must be refused.
- **Whose is it.** Two shoppers exist on purpose — orders, addresses, reviews
  and reservations are all "mine", and a check that one person cannot see
  another's things is meaningless with one person.
- **The dish with choices on it.** Restaurant only, because modifiers are a food
  capability in `ItemTypes`. Three things must all be true and each fails
  quietly on its own: the menu SHOWS the choice and its price, the bill CHARGES
  the shop's own delta, and the line REMEMBERS what was chosen — that last one
  is the failure money cannot reveal, because the total is right. Plus the
  fences (required group, group limit, an option from another dish) and the
  completion hop, where the sale must ring what the customer agreed to rather
  than counting the delta twice.
- **What the kitchen took off the menu.** Asked of every shop, not just the
  restaurant: `sold_out_at` is gated on `products.manage` and nothing else, and
  a mart that runs out of milk at seven has the same evening. The check 86s the
  item, watches the counter refuse it, watches the app refuse it, **then puts it
  back and orders it again** — without that last step there is no telling
  "refused because it is sold out" from "refused because this shop is shut".

Two things to know before changing it:

- **`/auth/register` is under `throttle:auth`** — five per minute per IP, shared
  with every other login the sweep makes. The two shoppers have stable
  addresses, are registered once, and a 422 on a later run means "already
  there". Do not give them random emails.
- **The phase opens its own shops.** A shop is orderable only when active,
  `online_shop_enabled`, `setup_completed` and the `marketplace` module are ALL
  true, and sweep tenants never needed the last two. Phase R flips the module
  with the admin token and finishes setup with the owner's, for a restaurant and
  a chemist — a grocery order is the easy path. Coverage is `R  3`. It touches
  the `marketplace` flag only; phase F's module-wall test uses `inventory`.
- **A refusal has to be about the thing being tested.** The prescription check
  asks whether a stranger can order a `requires_prescription` medicine on a
  phone. Its first version read only the status — and the medicine it made had
  no stock, so a 422 for having none read exactly like a 422 for needing a
  prescription. It stocks the shelf first and then requires the refusal to NAME
  the prescription.
- **The dish keeps no stock, deliberately.** `Sweep Pizza` is created with
  `track_inventory: false` for the same reason: "none left" and "choose a crust"
  are both 422s.
- **The option ids come off the PUBLIC menu**, never from the owner's catalog.
  Reaching behind the counter for them would make every modifier check pass on a
  shopfront that publishes nothing.
- **`mutate.py` picks the restaurant for phase R now.** Without it every dish
  check reports "could not create one" and the mutations aimed at them come back
  UNCLEAR — a mutation pointed at a check that never runs proves nothing.

Anything it finds goes in [`FINDINGS.md`](FINDINGS.md) with the call that
produced it, and anything confirmed gets a test in the real suite before it is
fixed.

## Phase S — the shelf that ages

```bash
python3 run.py s          # pulls a, b, c in first
```

Stock can be dated two ways and the difference is the whole subject. **An expiry
is a FENCE** — a medicine past it may not be dispensed and the platform blocks
it. **An age is a HINT** — four digits on a tyre's sidewall, and rubber ages
sitting still whether or not anyone drives on it. Nothing becomes illegal on a
date, so nothing may ever be blocked.

Four claims, and the first has money in it:

- **Oldest first.** Selling takes the oldest lot on the shelf, measured from
  manufacture when there is no expiry to measure from. The FRESH lot is created
  first on purpose — insertion order already gives the wrong answer, so a pass
  has to be the ordering doing work rather than the database agreeing by luck.
- **Unknown last.** A lot nobody dated is neither new nor ancient; it waits.
- **Told.** The counter is told, by name, which lot it is handing over.
- **Never fenced.** And it sells anyway, because that was always the point.

**Not gated on a trade.** `stock_age_warn_years` is a shop setting, `dot_code` is
accepted on any lot, and `/inventory/ageing` asks the shop rather than the trade
— so every shop with the inventory module gets asked. A trade list in the phase
would be a second copy of an answer the product already has. 8 of 9 shops;
finance has no inventory module and is correctly skipped.

Two things this phase taught the harness, both worth knowing before writing
another one:

- **`Report.expect` reads a collection `want` as ALTERNATIVES**, not as a
  sequence. Phase S passed a list of expected rows and it asked whether the
  whole list equalled one of its own members — **reporting the exactly-right
  answer as something to look at, 18 times.** Phase T then passed an empty list,
  which nothing can ever satisfy, and got eight more. Two phases in two days, so
  `expect` itself was hardened: an empty `want` now says it is a caller bug, and
  when BOTH sides are collections it compares them for EQUALITY. Prefer being
  explicit anyway — compare an order as a joined string, a count as a number.
- **A claim whose failure is a defect must call `rep.bug`, not `rep.expect`.**
  `expect` files a QUERY, which is right for "this behaved differently than I
  guessed" and wrong for "the shop sold the wrong tyre" — and it makes the check
  **invisible to `mutate.py`**, which looks for BUG rows. A claim that can only
  ever emit a QUERY cannot be proven to have teeth.
- **A setup step that can fail silently turns every check after it into an
  assertion about the wrong world.** Phase S resets the shelf before each check;
  its first reset zeroed lots with a batch-scoped adjustment (which is **exempt
  from batch accounting by design**) and then deleted them (**refused, 422**, on
  any lot still holding stock). The phase stayed green, because the lots each
  check cared about had usually been depleted by the check before — but the
  reset could fail and said nothing when it did. It disposes of the lot the way
  a shop does now, and **files a QUERY when it cannot**. Setup is not exempt from
  the denominator rule just because it is not the thing being tested.
- **A phase must not name a product in a way another phase searches for.** Phase
  S gave its shelf item the SKU `SWEEP-SHELF-PETROLEUM`; product search reads the
  SKU, so it answered phase Q's search for "Petrol", sorted newest-first ahead of
  the real fuel, and the forecourt rate check spent its run trying to reprice a
  tyre. Which exposed the deeper fault: **phase Q was GUESSING which product was
  fuel** — search for "Petrol", else the first product in the shop. It asks
  `/fuel/tanks` now, because a tank names its product and that is the only
  authority. *A check that guesses its subject is a check about whatever happens
  to be first.*

## Phase T — who changed what

```bash
python3 run.py t          # pulls a, b, c in first
```

The audit trail recorded who may DO things and said nothing about what those
things are WORTH: a permission granted was recorded, a customer's credit limit
raised from Rs 5,000 to Rs 90,000 was not. Three questions:

- **Recorded.** An act that grants money authority leaves a row, with the
  actor's name and the value it had *before* — "it is 90,000 now" is on the
  customer record already; what a trail adds is what it was.
- **Quiet.** An act that does not — a phone number corrected at the counter —
  leaves nothing. *A trail that records everything is a trail nobody reads to
  the bottom of.*
- **Readable.** By the shop it is about, not by a cashier, and never by another
  shop.

**Always two shops.** `AuditLog` carries a `tenant_id` and is deliberately NOT
tenant-scoped as a model — the platform reads across every shop — so the tenant
endpoint's own `where` is the entire wall between one history and another, and a
run with one shop cannot see that wall at all.

## Asking as nobody — the failure that fakes 96 bugs

`Api.login()` returns `None` when a sign-in cannot be had: `throttle:auth` is
**5/min per IP** and a full run drives about a hundred identities, so a cold
token cache means minutes of pure waiting. A phase then called on with
`token=None`, which falls through to an ambient token that was **also** None,
the request went out **bare**, and the server's 401 was printed as a product
bug. One run produced **96 of them**, including *"the shop has a Main branch —
0 branches"* about a shop with eighteen.

- **A request that would carry no credentials does not go out.** It returns
  status `0` / `HARNESS_NO_TOKEN` — a status no route ever returns — and
  `run.py` **fails the whole run** if even one happens. *A summary that cannot
  be trusted must not read like one that can.*
- **`NOBODY` is still how you ask anonymously on purpose**, and `_login_fresh`
  uses it: a sign-in is the one call that must carry nothing, and the new guard
  blocked it on its first run.
- **A failed sign-in reports the server's own answer** (`why_login_failed()`),
  never a guess. Phase A used to say "is the seeder run?" about an account that
  logs in fine.

> **Read the throttle waits before reading the verdict.** If a run says
> anything surprising, `grep -c 'rate limited\|throttled'` first.

## Two rules for anything that touches a sweep shop

- **A throwaway probe must restore what it touched, or use a shop of its own.**
  A one-off script written to measure the audit trail suspended a cashier and
  set a discount ceiling, and left both — so the standing sweep reported two
  false bugs for days afterwards. *The lie outlives the probe.*
- **Every reusable fixture restocks.** Phase G's serialized product was created
  with fifty units and never topped up: each run ate one, and eventually the run
  reported `Insufficient stock: only 0 in stock` as a defect. The server was
  right — the sweep had emptied the shelf itself.

Two rules the sweep has already had to learn the hard way:

- **It must stay re-runnable.** Its second run reported eight bugs — "a business
  with this name already exists", the console refusing duplicates correctly. A
  sweep that can only run once is a sweep nobody runs. Every phase now reuses
  what it made: tenants, the product, the supplier, an open drawer.
- **A green run is worthless without `mutate.py`.** It breaks the sweep on
  purpose — freeze the stock reading, freeze the cost, freeze net profit, make
  every refusal read as success — and every lie must produce the matching
  finding. Each mutation names a `ran_marker` so the harness can tell "the check
  said nothing" (`MISSED`) from "the check never ran" (`UNCLEAR`). It could not,
  once, and reported two working checks as blind.

## The scanners next door

The sweep drives HTTP. Two things it therefore cannot see live beside it, and
both read **both repositories**, because the questions they answer only exist in
the gap between them.

```bash
python3 docs/qa/unreachable-pages.py           # rows the shop cannot reach
python3 docs/qa/unreachable-pages.py --prove   # break it on purpose first
shopos-backend/scripts/dead-endpoints.py       # routes with no caller, and the reverse
shopos-backend/scripts/dead-rules.py          # rules the code states and never consults
shopos-backend/scripts/one-rule-many-paths.py # rules only SOME selling paths ask
```

`unreachable-pages.py` asks whether every panel screen that lists a paginating
endpoint can reach row 31 — by turning the page or by searching. It found nine
that could not, one of them capped at ten rows. The panel's own
`ui/pager/reach.test.ts` keeps the other half true (nobody hand-rolls a pager),
and deliberately does not duplicate the endpoint list.

`dead-rules.py` lists every method whose NAME is a decision — `is*`, `has*`,
`can*`, `requires*` — that nothing anywhere calls. It found the sold-out hole
(`scopeSellableToday`, zero callers, three selling paths disagreeing) and a
supplier credit that could be recorded twice. Its output is **leads, not
findings**: of ten uncalled rules, one was a gap and nine were redundant or
enforced in a query instead. Each carries a line in `SETTLED` saying which.

`one-rule-many-paths.py` lists what each of the three selling paths refuses —
counter, online order, dine-in tab — and asks, of every rule only one of them
asks, whether the others could be. It is the shape of both of today's product
bugs: `ITEM_SOLD_OUT` in one column, then `DISCOUNT_LIMIT_EXCEEDED` in one
column. **Its useful moment is not the clean run** but the day a refusal is added
to one path and it asks about the other two.

### One scanner deliberately NOT kept

A **"settings nobody reads"** scan was prototyped and thrown away. All **58 keys**
in `ShopSettings::defaults()` have a real reader outside the form that writes
them — measured, not assumed, and worth having measured.

It would have reported nothing forever, because the bug it was built from is not
that shape. `stock_age_warn_years` WAS read — once, for a badge inside one
product's batch drawer — while its own UI copy promised the counter would be told
too. **A setting read in one of the several places its screen promised** is not a
setting nobody reads, and no scanner reads prose. A tool that always says zero is
false comfort, which is the exact mistake `dead-rules.py` made on its first day.

Read the DENOMINATORS, never the verdict. Both scanners print what they checked
over what exists, and `--prove` blinds the detector and requires the result to
*look* blind — zero folders judged, every route unplaced. A scan that reads
nothing reports "0 problems", which is character for character what a clean
sweep reports.
