---
name: shopos-reorder-and-labels
description: 2026-08-11 flow audit — reorder list was built-but-unreachable (fixed); permission labels moved to the server; two of my three findings were WRONG
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-11T14:46:41.340Z
---

Flow audit of all 331 tenant endpoints vs. what the panel calls. **Two of three
findings were wrong** — record that, because the wrong ones cost more than the
right one.

## WRONG — do not re-raise these

- **"The permission registry has three copies."** It does not. Both consoles
  share one `StaffPage` and both FETCH the catalog from the server via a
  templated `basePath`, which a path-literal grep normalises away.
- **"Expired stock cannot be written off."** `DELETE /inventory/batches/{batch}`
  zeroes the lot and posts a stock movement OUT referencing it. The panel has
  reached it from the batch manager for months.

Lesson: a grep for path literals cannot see a path built from a variable.
Confirm "no caller" by reading the screen, not by diffing strings.

## RIGHT — the reorder list

`GET /inventory/low-stock` + `useLowStock()` both existed; **no screen called
it**, so the dashboard's "12 items are running low" landed on the unfiltered
inventory list. Fixed: `Needs reordering` toggle driven by `?filter=low` (so the
dashboard deep-links), plus `Order these N items` → a draft PO with every low
item as a line at its last known cost.

The out-of-stock and expiring dashboard rows must NOT carry `?filter=low`: the
reorder list requires a reorder level, so an item at zero without one would be
missing from the screen sent to fix it.

## Permission labels now live on the server

`Permissions::LABELS` sits beside the permissions; the API ships
`{key, label, hint}`. `PermissionCatalogTest` fails when a permission is added
without a label — the guard that was missing when `tenants.reset_password`
shipped as a bare slug the panel humanised into "Tenants Reset Password". The
panel keeps its own map as a fallback for permissions a person still holds that
the catalog no longer offers.

Related: [[shopos-read-vs-manage]], [[shopos-no-roles]], [[shopos-qa-sweep-aug09]],
[[shopos-help-centre]].
