---
name: shopos-one-shelf-two-caches
description: STANDING — invalidate ["products"] and you must invalidate ["inventory"]; 9 sites did not, incl. PO receive and the branch switcher
metadata:
  type: feedback
---

`["products"]` is the catalogue. `["inventory"]` is what the Inventory screens
read (movements, reorder list, expiry, ageing, batches). **Two views of one
shelf.** Nine invalidation sites refreshed the first and left the second.

Worst: **receiving a purchase order** — the main way stock enters a shop. Also
branch transfer, fuel delivery, settled dine-in tab, converted quote, counter
order, completed till sale, and every product edit (including the reorder level
itself, so setting a level and seeing no change read as a broken screen).

**Sharpest: the branch switcher.** It named four keys and not inventory. No
inventory query key carries the branch — it travels as `X-Branch-Id` — so the
old branch's answer stayed cached under the same key. Switch branch, open Needs
reordering, see the FIRST branch's list under the SECOND branch's name, until
you navigate away and back. **A mounted query does not refetch on staleness
alone** (`staleTime: 30_000`, `refetchOnWindowFocus: false`). It now calls
`invalidateQueries()` with no key.

**Why:** a list of stock-moving endpoints is a list somebody maintains, and it
was already missing six. The pairing IS the detector, so it cannot rot. Cost is
nil — React Query refetches only ACTIVE queries.

**How to apply:** never add `invalidateQueries({ queryKey: ["products"] })`
alone. `e2e/stockAndInventoryTravelTogether.guard.ts` fails and names the file;
it has a denominator (>15 sites, >8 files) and is mutation-proven.

Related: [[shopos-low-stock-one-rule]], [[shopos-guards-share-a-blind-spot]].
