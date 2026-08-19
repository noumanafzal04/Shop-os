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

**Fourteen phases built. 927 checks in one run, 17 of 17 mutations caught.**

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

Anything it finds goes in [`FINDINGS.md`](FINDINGS.md) with the call that
produced it, and anything confirmed gets a test in the real suite before it is
fixed.

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
