# The two trades nobody ever seeded, and the paperwork none of them had

**Decided and shipped 2026-10-02.** The load-test world had seven shops and
no filling station, no workshop, no online orders and no quotations — so four
whole halves of the product had never met a thousand rows.

## What was missing, and why it mattered

`loadtest:audit` had been reporting these tables empty on every shop:

| Empty | What that actually meant |
|---|---|
| `fuel_tanks` … `forecourt_shifts` | the forecourt reconciliation had never run on anything but a hand-built three-nozzle fixture |
| `orders` | **the shop was never switched on** — see below |
| `sale_documents` | three of nine trades run on quotations and none had one |
| `customer_vehicles`, `warranty_claims` | a workshop's entire record of what it did to a car |

The `orders` one was not a missing fixture. `shop()` set
`online_shop_enabled = true`, and `Tenant::sellsOnline()` wants that **and**
the marketplace module, which no trade's defaults turn on. The tenant's own
docblock names this exact trap — *"the module went on and the shop stayed
invisible"* — and the fixture walked into it. Four shops now switch both on
together, and the four that would not take online orders (a filling station
does not deliver petrol to a house; an accountant has no catalogue) do not.

## The two new shops

**Khokhar Filling Station** (petroleum, two sites). Three grades, five tanks,
four pumps, ten nozzles, one tank charted in millimetres and the rest dipped
in litres — so both dip paths are live in the same close, which no
single-tank test can produce. Seven days of shifts per site over days 14 → 8,
deliberately clear of the till's week because one person cannot hold two open
shifts and the server is right to refuse it.

The gaps are seeded on purpose, and separately:

- a few litres **tested** back into the tank on some shifts — they moved a
  meter and were never sold, and a shift that ignored them reads as theft
  every morning;
- one attendant's nozzle running **ahead of the till** on some days —
  *unbilled at the pump*, a question about people;
- one tank quietly **light against its book stock** on others — *missing
  from the ground*, a question about the ground.

Those last two are never added together, and `theForecourtAddsUp` asserts
both kinds exist, because a forecourt where everything agrees proves the
module runs and nothing about whether it can see anything.

**Rahat Auto Workshop** (automotive). Eighty cars with registrations, 45 job
cards spread across all three columns of the bay board, complaints in the
customer's words, promised-by times, advances against parts, and conversion
to a sale on collection. Plus a warranty desk built the only way it can be:
give a part a serial, sell it with that serial captured at the counter, and
only then let it come back — any shortcut would skip the one rule worth
testing, that the desk works out whether the unit was covered from the sale
rather than taking the customer's word.

## Two things the fixture found about the product

**A rider with no app could never be settled.** Written up separately in
`shopos-rider-with-no-app.md`; the short version is that `delivered_at` had
exactly one writer and it was the rider APP, so the documented Model A shop
watched Rs 0 beside a rider holding the day's takings.

**Fuel in the ground was not fuel on the books.** Tanks were given an opening
dip and the products left at zero, so the first 128 fuel lines were refused
for want of stock — and `priceIt()`'s catch-all swallowed the reason, which
is how *"could not price the fuel line"* came to stand for *"there is no
petrol in this shop"*. That one was the fixture's, and it is the third time
this quarter a swallowed refusal has hidden what it was really saying. The
probe now re-asks without the net so the real message reaches the tally.

## The audit grew three sections

`theForecourtAddsUp` · `theCashOnTheBike` · `theBayBoard`.

The strongest check among them is the COD defect stated as an invariant:
**no completed delivery is still waiting to be called delivered.**
