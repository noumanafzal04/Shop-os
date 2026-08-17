# The shelf the till had and never showed

**2026-08-17.** Found by continuing the same question that found the member
discount: *what has the till been given that it does not read?*

## The mechanical check

Every store the catalog pull WRITES, against everything that READS it, ignoring
the plumbing:

| Store | Readers |
|---|---|
| `CATALOG` | 3 — barcode lookup, checkout pricing, shadow check |
| `CATEGORIES` | **0** |
| `CUSTOMERS` / `CUSTOMER_GROUPS` | 0 *(1 each after the member-discount fix)* |

And then the sharper version: `searchCatalog()` and `categoryIndex()` — a pure,
tested offline search written over that cache — had **exactly one caller
between them: their own test file.**

## What it meant

The POS product pane read `useProducts`, a plain HTTP query with no fallback,
and `client.ts` has no cache path of its own. So the moment the line dropped:

> **The pane went empty, and the only way to add anything was to scan a
> barcode.**

For a mart that is a bad afternoon — most things scan. **For a restaurant it is
the entire feature gone**, because a dish has no barcode. And FOOD is the first
of the three daily-revenue trades.

### Why the shadow run would never have caught it

A sale that cannot be started produces **no variance to look at.** Two weeks of
evidence would have come back clean on a till where half the shop could not
ring anything at all.

## The fix

`loadShelf()` reads the catalog and categories **once** — not per keystroke,
which is precisely what `searchCatalog`'s own note argued for: at twenty
thousand items the projection is a few megabytes, and scanning it in memory
beats a round trip to IndexedDB on every letter typed. `shelfRows()` then
filters in memory using the search and category index that already existed.

The POS swaps source on `connected`: online it pages the API as before, offline
it draws the same shelf from its own copy, with the same category tabs.

Paging is switched off offline rather than left dangling — the whole catalog is
already on the device, so "load more" would be a button asking a server nobody
can reach.

### What is honestly missing offline

**Images.** They are not cached, and shipping every product photo to every
tablet is the wrong trade. Tiles fall back to the letter placeholder they
already draw for an item with no picture. Brand, generic name and description
are not in the projection either — the description deliberately so.

Nothing pretends otherwise: a field that is not on the device comes back
undefined and the screen draws what it always draws.

## It was a cluster, not one gap

Running the same check across every export — *what is tested and has no caller
outside its own test?* — found the rest of it. The offline module was built
complete and **the POS screen was wired to none of it**:

| Built, tested, uncalled | What it meant offline |
|---|---|
| `searchCatalog` / `categoryIndex` | the product pane was empty |
| **`findByCode`** | **the scanner asked a server nobody could reach** |
| `withLocalStock` | the shelf showed whatever the last pull said |

Together: **a till could not put a single item in the cart, in any trade.**
Browsing fixed the kitchen; the scanner is how a mart actually sells; and
without the stock deltas a mart that shifts forty cartons of milk during
load-shedding still reads *forty, forty, forty* — and finds out when a customer
asks for the forty-first.

The stock figure is derived from the outbox rather than stored, which is why it
cannot drift: it **is** the queue.

### A note on the scan I nearly missed

The first version of the scan that found this had a bug of its own —
`RegExp.prototype.test` with a `/g` flag is **stateful**, so alternate calls
returned false and real callers looked absent. It reported `flushVariances` as
uncalled when `pullNow` calls it directly. Fixed by counting matches with a
fresh regex instead. Worth remembering: **an audit tool that produces findings
is a thing to verify, not to believe.**

## The pattern

**Ninth, tenth and eleventh**, in one cluster, and the largest yet: not merely data left unread, but a whole
written-and-tested capability with nothing a person touches able to reach it.
The codebase has recorded that exact sentence six times already.

> Ask what a mirror was GIVEN and does not use. Then ask what was BUILT for it
> and never called.

## Guard

11 tests in `browse.test.ts`. The load-bearing one is
`a kitchen with no barcodes › can still see its menu`. Mutation-checked:
emptying the no-search shelf fails 4 and only those.

Related: [shopos-member-discount-offline](shopos-member-discount-offline.md), [shopos-offline-plan](shopos-offline-plan.md), [shopos-sold-out-and-reachability](shopos-sold-out-and-reachability.md).
