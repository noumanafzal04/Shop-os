---
name: shopos-nearest-branch-fills-it
description: "2026-08-25 SHIPPED: online orders are filled by the NEAREST branch that holds the whole basket (not just nearest); orders.branch_id; release reads branch off the movement; closes the gap left by one-branch-runs-out"
metadata:
  type: project
---

Closes the open question in [[shopos-one-branch-runs-out]]. Nothing on `orders`
named a branch, so a chain's online shop was its **Main branch's shop**: ten in
Gulberg and none in Main refused the order with "only 0 in stock" about a shelf
the goods were never coming off.

## The rule

**The nearest branch that holds the WHOLE basket.**

- Nearest ALONE would turn a customer away whenever the nearest shop is short
  one line — and filling from the next shop along is the whole reason a business
  opens a second one.
- **One branch fills the whole basket.** Splitting = two riders, two fees. When
  no single branch can, the nearest is chosen anyway and the per-line check
  refuses naming the ITEM ("no branch has all of this" is useless to everyone).
- **No pin → default branch**, i.e. exactly the old behaviour. Single-branch
  shops untouched.

## The parts that would have gone wrong quietly

- `OrderService::stockDraw()` is ONE answer to "what does this line take off a
  shelf", used by the hold AND by `FulfillingBranch`. Two copies would part
  company on the first deal (draws components at their own SIZE) or pack
  (multiplier).
- **The release reads `$mv->branch_id` off the movement**, never re-derives it.
  Re-deriving puts a Gulberg hold on Main's shelf and both counts drift further
  every cancel.
- **A collecting customer is told which shop** — pickup used to be Main every
  time so nobody had to be told; now the system chooses, so the marketplace
  allow-list carries branch name/address/phone.

## The lesson worth keeping

A mutation caught **my test, not my code**. `the nearest branch fills it` passed
with distance sorting switched OFF, because the fallback order is `is_default`
then NAME and I'd named them "Gulberg" (near) and "Johar Town" (far) — the
alphabet gave the same answer as the geography. Renamed to **Zamzama** (near) /
**Airport Road** (far) so alphabet and distance DISAGREE.

Second time in one day I wrote a test that passed against the thing it named
(the other: [[shopos-mirror-and-refusal]]). Both caught by mutation, neither by
reading. See [[shopos-workflow-test-rule]].

**Not done on purpose:** delivery fee by distance (price would depend on a stock
level the customer cannot see); splitting a basket across branches.
