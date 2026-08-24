# A kitchen runs out. A chain does not.

**2026-08-24 · backend + panel**

## What it cost

Eighty-sixing belonged to the SHOP. So a chain with two kitchens had one switch
between them: Gulberg lost its last pizza bases, the chef took the pizza off,
and DHA — with a full tray — stopped selling it too.

Nothing was broken. The feature had been built one dimension short of the thing
it describes, for the second time in a week:

| dimension | the sentence |
|---|---|
| product | "no pizza tonight" |
| size | a pizzeria runs out of large bases, not of pizza |
| **branch** | **Gulberg has none; DHA has a tray** |

Each was added after the one before turned out to be short. The size one shipped
seven days earlier.

## One source of truth, deliberately

The cheap move was to keep `products.sold_out_at` as "off everywhere" and add
per-branch rows beside it. **That is two places holding one fact**, and this
codebase has paid for that shape repeatedly — the copy that drifts is always the
one written by somebody else on another day.

So the columns went, and every flag they held was written out as a row **per
branch**: a shop that had something off stays exactly as it was, at every branch
it owns. Nothing silently comes back on sale during a deploy.

`branch_sold_out` has no `is_sold_out` column. **The row's existence is the
fact**, so there is nothing to fall out of step with.

## Where the branch comes from

`SoldOutController` takes the **operating** branch (`BranchContext::id()`),
never the read scope — the same rule receiving a delivery follows, and for the
same reason: goods arrive somewhere definite, and so does running out of them.
An owner in the all-branches view is asked which one rather than guessed at.

The dine-in tab asks the **ticket's** branch, not the operator's: a manager
covering two sites can have their context on one while the tab belongs to the
other, and the kitchen that has to cook this is the tab's.

## And the online door, which has no branch at all

Nothing on `orders` names a branch. `InventoryService` defaults to the tenant's
default one, so an online order already holds and deducts stock from Main.

So the online path asks **Main's** answer — because that is the shelf it takes
from, and answering from anywhere else would let it promise a dish out of a
kitchen it is not going to draw on.

**This is a consequence, not a design.** Until an order can name the branch that
fulfils it, a chain's online shop is its main branch's shop. Measured, before
any of this:

```
Main = 0   ·   Gulberg = 10
online order (2 units)  →  422  "Insufficient stock: only 0 in stock."
```

A refusal on a full shelf, one branch over. That gap is still open and is a
product decision — nearest branch, a chosen "online branch", or a shop-wide
pool.

## The silent press, found only in a browser

The backend was right and its twenty-four tests were green. Writing the browser
test found what they could not: **an item with no sizes has no sheet to open, so
the press landed with no word at all.** The row changed colour; nothing else.

Fine in a one-shop business. In a chain, a chef had no way to tell whether they
had closed their own kitchen or the company. The server's reply already carried
the branch — *"Pizza is off the menu at Gulberg."* — and nothing was showing it.

The sheet names the branch too, and says the rest of the chain keeps selling.
Both only where a shop HAS more than one branch: "at Main" told to a single-shop
owner is noise about a choice they do not have.

## Two things caught before they shipped

**The migration dropped a column while an index still named it.** Sqlite refuses
outright; MySQL would have carried it silently. This is exactly the shape the CI
gate that runs migrations back *down* was written for, and it caught this one on
the machine.

**`pint app/` was run instead of `pint <paths>`** — against a standing rule —
and reformatted twenty-seven unrelated files. Reverted; the diff is the work.
