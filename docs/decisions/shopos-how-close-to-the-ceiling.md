# A shop was billed for its own typos, and warned about nothing

**Decided and shipped 2026-10-02.** Two of the six gaps found when the admin
plans/usage model was checked against the code; these are the two that were
*wrong*, as opposed to merely absent.

## One: the meter counted cancelled sales

```php
'orders_month' => Sale::withoutTenancy()->where('tenant_id', $tenant->id)
    ->where('created_at', '>=', now()->startOfMonth())->count(),
```

This is a **billing** meter. A cancelled sale is a mistake somebody
corrected, and counting it charges a shop for mis-keying — a busy counter
with a clumsy evening paid for its own typos.

Training sales were already excluded, and the mechanism is worth knowing:
`Sale`'s `not_training` global scope survives `withoutTenancy()`, which drops
only the `tenant` scope. Cancelled ones had no such scope.

**A refunded sale still counts, deliberately.** The sale happened, the goods
went out and came back, and the system did all the work twice. The cancelled
one never happened at all.

## Two: nothing said "nearly"

Three limits are `enforced => false`: reported, never blocking. That is the
right call for a till — a hard stop in the middle of a queue is the exact
failure the whole offline module exists to avoid — but the silence beside it
was not. A shop sailed past its included transactions and **neither screen
said a word**.

`PlanLimits::snapshot()` now carries two more fields:

| | |
|---|---|
| `percent` | how close, or **null** when unlimited — not 0, which would sort an unlimited shop to the wrong end of every list |
| `band` | `ok` / `nearing` (80) / `critical` (90) / `reached` |

### Why the band is computed on the server

Both the admin console and the shop's own Subscription page draw this figure,
and each had its own local `>= 80`. Two copies of one threshold part company
the first time somebody tunes one — the shop reading "nearly full" while the
platform's own console still said fine. Same family as *Low Stock, One Rule*.

### A policy is not a quota

`offline_days` gets **no band**. It reports the worst device currently out of
contact, and a tablet three days out against a three-day window is a tablet
that is late, not a quota that is spent. "Reached" is a billing word and
would read as an invoice.

### And the wording follows `enforced`

A product ceiling refuses the next product. The monthly transaction count
refuses nothing. The shop's page used to say *"Full — ask support to extend
this before adding more"* for both, which is a lie that frightens a shop off
its own counter. It now says what is actually true of each.

## Still open from that model

Add-ons as rows, temporary grants, a billing-period meter instead of a
calendar month, and retention/archive. All four are "not built", none is
wrong today, and they are recorded in memory rather than half-built here.

## Proof

`tests/Feature/HowCloseToTheCeilingTest.php`, eight tests — including the two
that keep the fix narrow: an unlimited resource has no percentage at all, and
a policy never gets a band.
