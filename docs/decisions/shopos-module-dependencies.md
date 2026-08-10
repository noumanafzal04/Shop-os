---
name: shopos-module-dependencies
description: "How the modules depend on each other, which trade exercises which chain, and where the QA workflow tests live"
metadata:
  node_type: memory
  type: reference
---

# How the modules fit together

Three independent gating axes decide what a given person sees. They are **not**
a hierarchy — a shop can fail any one of them and pass the other two:

| Axis | Source | Answers |
|---|---|---|
| MODULE | `tenants.features` | Has this shop bought the capability? |
| TRADE | `business_type` → `BusinessTypes::primary()` | Does this kind of shop need it? |
| PERSON | `permissions` | Is this member of staff allowed? |

Seventeen trade codes collapse to eight canonical ones, so a trade branch must
always resolve rather than match — `clinic` is a pharmacy, `workshop` is
automotive, `restaurant` is food. A `=== 'pharmacy'` comparison against a raw
`business_type` is a bug, and `EveryTradeLoadsTest` exists to catch it.

## The declared graph

`App\Support\Modules` carries a `depends` key per module. This table is
generated from it — if the two disagree, the code is right.

```
products      Selling         needs: —
services      Selling         needs: —
pos           Selling         needs: —
expenses      Back office     needs: —
inventory     Back office     needs: products
images        Back office     needs: products
marketplace   Online          needs: products
delivery      Online          needs: products
reservations  Online          needs: products
dine_in       Trade-specific  needs: products
fuel          Trade-specific  needs: products + inventory
```

Four modules stand alone. **`expenses` depending on nothing is the important
one** — it is what lets a books-only shop exist with no catalog at all, and
that tenant shape is the sharpest test of whether module flags really reach the
routes.

Note that `pos` does not declare a dependency on `products`. A till can sell a
service, so the coupling is real but softer than the graph would suggest.

## The chains that actually break

The declared graph says what may be switched on. It does not say where the
**seams** are, and the seams are where this codebase has historically broken:
a capability built, and one link missing. Nine of those in a single week — each
one green in the unit tests of the module that owned it, because no test walked
from one module into the next.

`tests/Feature/TradeWorkflowTest.php` walks them. One test per chain, and the
assertion is always on the **far end**: receive stock and check the ledger, not
the stock table; fire a course and check the kitchen screen, not the ticket.

| Chain | Trade | What breaks silently without it |
|---|---|---|
| inventory → POS → ledger | mart | Stock and cash disagree about the same three events |
| dine_in → kitchen → sales | food | Food is ordered and never cooked |
| inventory:batches → POS | pharmacy | FEFO degrades to FIFO; short-dated stock is destroyed |
| item_type → inventory (absent) | services | A haircut moves stock; inventory drifts impossible |
| module gating → screens | finance | Catalog returns empty instead of forbidden |
| inventory off ⇏ POS off | mart | A shop loses a till it still pays for |

## Two traps these tests were written into

**Assert on the figures, not the envelope.** Both mistakes were made here
first, and both passed:

- `GET /restaurant/kitchen` returns `{kots, stations, server_time}`, so
  `assertNotEmpty($data)` is true of a kitchen where nothing was ever fired.
  Assert on `data.kots`.
- `GET /cashbook` emits one row per day in the range whether or not anything
  happened, so "not empty" is true of a shop that never opened. Assert on
  `sales_revenue` / `refunds` / `net`.

Each chain was verified by mutation: remove the `fire` call and the kitchen
test must fail; skip the refund and the ledger test must fail. A workflow test
that still passes with a step deleted is testing nothing, which is worse than
having no test, because it reads as coverage.

## Demo data

`DemoDataSeeder` has to contain the features that shipped into it, or QA has
nothing to click. It stopped covering the product for weeks: refunds, income,
budgets, schedules and closed shifts were all built and then absent from every
demo tenant. `DemoWorldIsCompleteTest` asserts presence and shape — never
counts, because the demo world is meant to keep growing.

**Metro Chain Superstore** is the only multi-branch tenant, and it exists for
one reason: every money screen scopes by branch, and with one branch per tenant
a scoping bug looks exactly like a working one.
