# The nearest branch that can actually fill it

**Date:** 2026-08-25
**Status:** shipped — `orders.branch_id`, `App\Support\FulfillingBranch`, `OrderService::stockDraw()`
**Closes:** the open question left by [one-branch-runs-out](shopos-one-branch-runs-out.md)

## What was wrong

Nothing on `orders` named a branch. `InventoryService` falls back to the
tenant's default one, so an online order in a chain was **answered by, held
against and deducted from Main** — whichever branch happened to carry that flag.

A shop with ten of something in Gulberg and none in Main refused the order and
told the customer *"Insufficient stock: only 0 in stock"* about a shelf the goods
were never going to come off. The code said so itself, in a docblock: *"until an
order names the branch that fulfils it, a chain's online shop is its main
branch's shop."*

## The rule

> **The nearest branch that holds the whole basket.**

Three decisions inside that sentence, and each was a choice:

**Nearest, but not nearest alone.** If the branch round the corner is out of one
line, a chain fills the order from the next one along rather than turning the
customer away. Ranking by distance and stopping at the first result would refuse
orders the business can plainly fulfil — and that ability is the entire reason
somebody opens a second shop.

**One branch fills the whole basket.** Splitting across two is two riders, two
delivery fees, and two things to go wrong on a twelve-item order. When no single
branch holds all of it, the nearest is chosen anyway and the ordinary per-line
check refuses with a message naming the **item**. "No branch has all of this" is
true and useless to the customer and to the shop alike.

**No pin means no change.** A phone order, a customer who never shared a
location, a branch nobody put on the map: distance is unanswerable, so ranking
falls back to the default branch. That is deliberately the OLD behaviour — a
shop that has not mapped its branches gets what it had, not a silent reshuffle.
A single-branch business is untouched in every case.

## One question, two askers

`stockDraw($line)` is the only answer to *"what does this line take off a
shelf"*. The hold debits it; `FulfillingBranch::holdingAll()` is handed the same
figures to choose a branch.

Two copies would have parted company immediately, on the two shapes that are
easiest to forget:

- a **deal** holds nothing of its own and draws each component down at the
  component's own size (a parent's stock figure is an orphaned leftover, always
  zero);
- a **pack** is a multiplier — a box of twelve draws twelve base units.

Get either wrong in only one of the two copies and the branch is chosen against
one basket and debited against another.

## And the way back

A release now reads `$mv->branch_id` **off the movement** rather than
re-deriving it from the order. Stock goes back exactly where it came from.

Re-deriving would be a second opinion about a fact already recorded, and the two
would part company the first time an order was cancelled after its branch was
renamed or closed — putting a Gulberg hold onto Main's shelf and leaving both
counts wrong in opposite directions, a little further every cancel. This is the
half that would have gone wrong quietly, so it has its own test.

## A collecting customer is told which shop

Pickup was always the default branch, so nobody had to be told. Now the system
chooses, and an order for collection carries the branch **name, address and
phone**. The marketplace response is an explicit allow-list and stays one: what
a customer needs to walk there and ring the bell, and nothing else.

Creating an obligation and not meeting it would have been the worse half of this
change — a pickup order pointing at a shop the customer cannot identify.

## Proven by mutation, and one mutation caught the test

| Mutation | Failed |
| --- | --- |
| `ranked()` ignores distance | *the nearest branch fills it*, *no branch holds it all* |
| `holdingAll()` takes the nearest regardless of stock | *the nearest one that CAN fill it*, *cancelling returns the stock* |
| the release forgets which branch it came from | *cancelling returns the stock to the branch it came from* |
| the customer is not told the branch | *a collecting customer is told which shop to walk to* |

The first of those failed only **one** test at first. `the nearest branch fills
it` passed with distance sorting switched off, because the fallback ordering is
`is_default` then **name**, and I had called the near branch "Gulberg" and the far
one "Johar Town" — the alphabet gave the same answer as the geography.

The branches are now **Zamzama** (near) and **Airport Road** (far), so the
alphabet gives the opposite answer and only distance can produce the expected
one. Second time in one day that a test of mine passed against the thing it
named; both were caught by mutation and neither by review.

## Deliberately not done

**Delivery fee by distance.** The fee is the shop's flat setting and stays that
way. Charging by how far the chosen branch happens to be would make the price
depend on a stock level the customer cannot see.

**Splitting a basket across branches.** See above. It is a real feature for a
large chain and a different build: sub-orders, more than one rider, and a
customer who has to be told their order arrives in two pieces.
