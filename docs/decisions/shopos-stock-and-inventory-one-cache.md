# The shelf and the stockroom screens are one thing, cached as two

**2026-08-30**

`["products"]` is the catalogue. `["inventory"]` is what the Inventory screens
read — movements, the reorder list, expiry, ageing, batches. They are two views
of the same shelf. Nine invalidation sites refreshed the first and left the
second alone.

The worst of them: **receiving a purchase order**, which is the main way stock
enters a shop. A buyer who had just booked in a delivery still saw those items on
Needs reordering, and no receipt on Stock movements. Also: a branch transfer, a
fuel delivery, a settled dine-in tab, a converted quote, a counter order, a
completed till sale, and every product edit — including the reorder level itself,
so setting a level and finding the list unchanged read as a broken screen.

## The branch switcher was the sharp one

It named four keys — products, branch-stock, dashboard, sales — and inventory was
not among them. None of the inventory query keys carry the branch, and the branch
travels as an `X-Branch-Id` header, so the cached answer for the old branch stays
cached under the same key. Switch to a second branch, open Needs reordering, and
it kept showing the **first** branch's list under the second branch's name until
the page was navigated away from and back. A mounted query does not refetch on
staleness alone.

It now calls `invalidateQueries()` with no key. Changing branch changes the
answer to almost every tenant-scoped read; a list of branch-scoped keys is a list
somebody has to maintain, and it was already wrong.

## The rule

Wherever `["products"]` is invalidated, `["inventory"]` is invalidated beside it.

Not a list of stock-moving endpoints. A list needs maintaining and this one was
missing six entries. The pairing costs nothing when inventory screens are not
mounted — React Query only refetches **active** queries — and it cannot rot,
because the detector is the pairing itself.

`e2e/stockAndInventoryTravelTogether.guard.ts` holds it, with a denominator
(more than 15 sites across more than 8 files, or the regex has stopped matching)
and mutation-proven: deleting the line from `usePurchases.ts` fails the guard and
names the file.
