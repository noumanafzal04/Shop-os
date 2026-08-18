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

| Phase | What it covers | Needs |
|---|---|---|
| **A** | Admin side — plans, tenants, modules, limits, billing | nothing |
| **B** | Per-trade setup — settings, catalog shape, units, item types | A |
| **C** | Selling — POS, tenders, returns, held tickets, shifts | B |
| **D** | Stock — receive, adjust, transfer, disposal, and what selling did to it | C |
| **E** | Money — expenses, income, drawer, ledger, khata, reports | C |
| **F** | The seams — where two modules meet. **Most bugs live here.** | D + E |
| **G** | Trade depth — the things only one trade has | F |
| **H** | Offline — the till with no server | G |

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

## Running it

The API harness lives at `docs/qa/sweep/` and drives the flows against
`http://localhost:8000` with a seeded tenant per type. It is deliberately not a
test suite: it is a **sweep** that reports what it saw, so a surprising answer
is something to look at rather than a red build.

```bash
php artisan migrate:fresh --seed          # staging/local ONLY
python3 docs/qa/sweep/run.py              # everything
python3 docs/qa/sweep/run.py --type mart  # one trade
```

Anything it finds goes in [`FINDINGS.md`](FINDINGS.md) with the call that
produced it, and anything confirmed gets a test in the real suite before it is
fixed.
