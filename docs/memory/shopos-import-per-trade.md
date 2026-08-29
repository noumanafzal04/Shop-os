---
name: shopos-import-per-trade
description: FIXED — one product-import template went to every trade and the importer refused its own rows; now generated per business type, plus variants via parent_sku
metadata:
  type: project
---

**2026-08-29.** Shop reported "error uploading import product files". Reproduced
on live: a restaurant downloaded its **own official template** and uploaded it
back **unchanged** →

```
Imported 4 new, 2 failed.
  row 3 -> Item type "medicine" isn't available for this business type.
  row 7 -> Item type "service" isn't available for this business type.
```

**Two bugs.** We handed out a file we then refused — AND the 4 rows that
succeeded put "Loose Sugar" and "Galaxy A16" into a restaurant's catalogue,
named like real stock.

**Cause = TWO LISTS.** Template had 6 hard-coded rows; importer validates
against `BusinessTypes::itemTypesFor()`. They drifted.

**Fix:** template is **generated from the shop that asks**, rows come off the
*same* list the validator reads → cannot offer a row the importer refuses, and a
new trade gets a correct template with nobody writing one. Columns narrow per
trade (`ProductCsv::TRADE_ONLY` + `headersFor()`); **EXPORT stays full** (it's a
backup).

**Variants now importable** — a size is a ROW with `parent_sku`, not a cell:
- **No IDs anywhere in the CSV.** Category by name (created if missing), tax
  group by name, parent by **SKU**. A shopkeeper knows their SKU, not a uuid.
- **Two passes** so row order doesn't matter (Excel sort puts Large above T-Shirt).
- **MERGES, never replaces.** `SyncProductVariantsAction` retires whatever is
  missing from the list it's given — correct for the edit screen, catastrophic
  for a partial import (fixing Large's price would silently retire Small/Medium,
  found only when the till refused them).

**Two bugs I caused, both caught by tests:**
1. `categoriesFor()` returns value/label **sub-trade** pairs, not shelf names —
   use `get($type)['product_categories']`.
2. Adding a `Parent SKU` header **shifted every export cell after SKU** — export
   rows are built POSITIONALLY. Silent round-trip corruption.

The old "template header == export header" test was deliberately replaced: now
"every template column is one the export knows" + a denominator proving the
narrowing is real.

2365 backend tests green. See [[shopos-packaging-units]] (pack units already
existed), [[shopos-promise-in-another-file]].
