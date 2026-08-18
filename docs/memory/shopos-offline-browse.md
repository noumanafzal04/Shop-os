---
name: shopos-offline-browse
description: "2026-08-17: offline the POS could not add ANY item — empty pane, scanner hitting a dead API, stale stock. searchCatalog/findByCode/withLocalStock were all built, tested and uncalled. Fixed."
metadata:
  type: project
---

`docs/decisions/shopos-offline-browse.md`. Found by pushing the question that
found [[shopos-member-discount-offline]]: **what has the till been given that it
does not read — and what was built for it and never called?**

**It was a CLUSTER.** The offline module was built complete and the POS screen
was wired to none of it:

| Built, tested, uncalled | Offline consequence |
|---|---|
| `searchCatalog` / `categoryIndex` | the product pane was **empty** |
| `findByCode` | **the scanner asked a server nobody could reach** |
| `withLocalStock` | the shelf showed whatever the last pull said |

Together: **a till could not put a single item in the cart, in ANY trade.** A
mart shifting forty cartons during load-shedding still read *forty, forty,
forty*.

**The shadow run would never have caught it:** a sale that cannot be started
produces no variance, so a fortnight comes back clean on a dead till.

Fixes: `loadShelf()` reads catalog + categories **once** (not per keystroke)
and applies `withLocalStock`; `shelfRows()` filters in memory; `scan()` falls
back to `findByCode` when offline. Paging off offline. **Images honestly
absent** — not cached, wrong trade.

**Caution about the audit itself:** the first scan had a bug — `RegExp.test`
with a `/g` flag is **stateful**, so real callers looked absent and it reported
`flushVariances` as uncalled when `pullNow` calls it directly.

> **An audit tool that produces findings is a thing to verify, not to believe.**

**Ninth, tenth and eleventh instances of the pattern, in one cluster, and the
largest yet.**

Related: [[shopos-offline-plan]], [[shopos-sold-out-and-reachability]].
