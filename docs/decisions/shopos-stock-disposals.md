# Where stock went when it left without being sold

**Decided and shipped 2026-08-16.** Found by reading the PHARMACY trade during
the business-type audit; recorded in `docs/audit-2026-08-12/VERIFIED.md` as
item 18.

## The problem

A medical store's money does not mostly leak at the counter. It **expires on the
shelf** — and that loss is avoidable, because distributors here take medicine
back for credit inside a window that closes **months** before the printed date.

The platform computed the warning perfectly: batches, FEFO, an expiry fence that
refuses to dispense past the date, a dashboard count. Then a pharmacist could
act on none of it in a way the books could see.

### Three parts that compounded

**One reason string for three unrelated events.** `BatchController::destroy`
wrote a single movement reading `"Batch X removed/expired"` and hard-deleted the
batch. That string covers:

| What actually happened | What it means |
|---|---|
| Written off | Binned. A loss. |
| Returned to the distributor | Money owed back. Not a loss. |
| Mis-keyed lot | Not an event at all. |

And `product_batches.cost` went with the deleted row, so *"what did expiry cost
me this year"* was unanswerable from ingredients that existed a moment earlier.

**No return-to-supplier concept existed.** `SaleReturn` covers customer returns;
`purchase_return | debit_note | credit_note` grepped to nothing across both
apps. The claim — the part that recovers real money — had no record anywhere.

**The warning was timed to be useless.** `expiringWithin(30)`, hardcoded in
`DashboardService`, `BatchController` and the panel's `useExpiring`. A
distributor's return window is typically 3–6 months.

## The decisions

### A batch with stock in it may not vanish unexplained

`DisposeBatchRequest` requires `disposition` and `reason` **only when the lot
still holds stock**, read from the batch and not from the request.

An empty lot is housekeeping — a mis-keyed batch number being tidied. Demanding
a reason for that trains somebody to pick whatever clears the dialogue fastest,
and a field answered that way is worse than no field.

### The two dispositions are never summed

`written_off` is money already lost. `returned_to_supplier` is money **neither
lost nor recovered**, and only recovered if somebody chases it.

Adding them produces a loss figure overstated by everything the distributor is
about to pay back — and a shopkeeper would price against it. Separate tabs,
separate totals, and no figure on the screen crosses them.

### Unknown is not zero

`total_cost` stays `null` where the lot never carried a cost. Zero is a claim
that the medicine cost nothing. The disposals screen counts those rows and
excludes them from the value, and says so on the strip.

### A return does not post to the supplier ledger

It is a **claim**, not a payment. The distributor decides what they credit and
when, usually for less than was asked. Crediting the shop's books the moment a
box leaves would put money in them nobody has agreed to.

`credit_received` is recorded separately, as **what arrived** — never defaulted
from `credit_expected`, because a short credit note is the normal case and
pre-filling would make agreeing with it the path of least resistance. The gap
between the two is the figure worth reading.

### Snapshots, deliberately

`batch_number`, `expiry_date` and `unit_cost` are copied onto the disposal
rather than referenced. The batch row is gone by the time anyone reads this —
**that disappearance is the defect this table exists to fix.**

### The expiry window belongs to the shop

`ShopSettings::expiringSoonDays()` — **one place**, because the dashboard tile
and the screen it links to must agree about which lots are urgent. A tile
reading "0 expiring soon" over a list of dying stock is worse than either being
wrong alone.

- Pharmacy: **90 days.** The distributor works in months.
- Everyone else: **30.** A bakery warned ninety days out is warned about nothing.
- An explicit tenant setting always wins — the shop knows its own distributor's
  terms better than a default can. Clearing it hands the question back to the
  trade rather than pinning a number nobody chose.

## A lead checked and found FALSE

I suspected `destroy()` double-depleted batches: it zeroes the lot and then
issues an `out`, which FEFO would take from a *different, good* lot.

It does not. `reference_type: 'batch'` sets `$batchScope = false` in
`InventoryService`, which skips both the expiry fence and the FEFO loop — and
the code already documents exactly why. **Verified before building on it**, per
the standing rule that roughly two of three audit leads turn out to be bad
questions rather than bad code.

## Not built

**No supplier-ledger integration.** See above — a claim is not a payment.

**No automatic return suggestion.** The system knows what is near expiry and
who supplied it, and could propose the return. It does not, because which lots a
distributor will actually accept is a relationship, not a rule, and a list the
rep rejects half of is a list the pharmacist stops opening.

Related: [[shopos-pharmacy-edges]], [[shopos-business-priority]].
