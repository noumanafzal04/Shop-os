# The loss that makes no noise

**2026-08-17.** The last of the three open gaps from the Aug-09 sweep, and the
one worth the most.

## Everything was built and none of it spoke

Batches carry expiry dates. The dashboard counts what is near. The pharmacy
screen lists it. Disposals records where it went and knows the difference
between binned and returned-to-supplier.

**All of it pull-only.** A shop learned its stock was dying by going to look,
which means it learned on the day somebody happened to look.

> Expiry is the only loss in a shop that is completely silent. Nothing breaks,
> no figure looks wrong, and the stock sits on the shelf looking exactly like
> stock. It stops being money on a specific date and nobody is told.

Every other loss announces itself. A till that will not open, a drawer that is
short, a supplier who did not deliver — somebody notices the same day. Expired
stock is discovered by a customer at the counter, or by a stocktake months
later, and by then the decision that would have saved it (sell it down, agree a
return) is long past.

## The design question was not *whether* — it was *how often*

A daily "you have 43 items expiring" is **worse than silence**. It is the same
sentence every morning, so it stops being read inside a week — and then the
morning it says 44, nobody notices that either.

So it speaks **per lot, per stage, exactly once**:

| Stage | What it says |
|---|---|
| **Approaching** | The lot crosses the shop's own window. *"Still time to sell it down or agree a return with the supplier."* |
| **Expired** | It is past the date. *"It cannot be sold. Record where it goes in Disposals: binned is a loss, returned to the supplier is money owed to you."* |

The dedupe key is the batch plus the stage, so a lot tells you **twice in its
life and never again**. A pharmacy with two hundred lots does not get two
hundred alerts — lots cross a threshold on the days they cross it, a handful at
a time.

### Two stages, not three

The obvious third — *"return it to the distributor now"* — needs a number
nobody has given us. Supplier return terms are per-contract, and inventing 30
days would be **a guess dressed as advice**. The shop's own
`expiring_soon_days` is a number the shop chose: 90 for a chemist, 30 for
everyone else, or whatever they set when their distributor works to six months.

### The first morning

The awkward run is the first one against an existing shop: every lot already
inside the window crosses it at once, and a chemist who has never seen this
could wake to eighty notifications. Capped at **20 per shop per run** — the
rest arrive tomorrow, and nothing is lost by waiting, because the dedupe means
they are still owed.

Expired lots are sent **before** approaching ones, so a capped run spends its
budget on stock that can no longer be sold rather than stock with weeks left.

## What it deliberately does not do

It does not remove, reserve, block or price anything. Expired stock is
**already** unsellable — `InventoryService` refuses to let an OUT dip into an
expired lot. There is nothing here to enforce. This is only the sentence that
arrives before somebody finds out at the counter.

## Where it runs

`Schedule::command('stock:expiring')->dailyAt('07:00')` — before the shutters
go up, so it can be the first decision of the day rather than the last.

## Tests

`ExpiringStockAlertTest`, 11 tests. The load-bearing one is not that it
alerts — that is the easy half — but **`test_a_lot_is_mentioned_once`**.

Mutation-checked: removing the dedupe key fails 2 tests and only those;
flipping the expired-first ordering fails exactly the one assertion about it.

Related: [shopos-stock-disposals](shopos-stock-disposals.md), [shopos-pharmacy-edges](shopos-pharmacy-edges.md), [shopos-qa-sweep-aug09](shopos-qa-sweep-aug09.md).
