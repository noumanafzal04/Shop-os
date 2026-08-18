---
name: shopos-read-vs-manage
description: "2026-08-08 SHIPPED — the `*.manage` bug class (a write permission gating a read); EnsurePermission is now ANY-of, Permissions::READS_* sets, PresetCanDoItsJobTest"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-07T20:59:43.071Z
---

**The bug that cost a real shop an evening**: owner created a Cashier preset,
signed in at the till, empty product grid. 50 products existed. `GET /products`
was gated on `products.manage` — the permission to EDIT the catalog. 403 →
panel rendered `data ?? []` → **a permission bug disguised as a data bug**.

## The rule now

**Reads get a SET, writes keep a single permission.** `EnsurePermission` reads a
comma-joined list as ANY-of (same shape `EnsureFeature` always had), backed by
`User::hasAnyPermission()`. Named sets live in `Permissions::READS_*` so a route
says WHY several jobs share a read.

`SUPERVISES_TILLS = settings.manage,reports.view` — `reports.view` is the honest
marker for "supervises rather than works a lane". Half the codebase said "a
manager does X" in a docblock and asked for `settings.manage` on the next line,
which the Manager preset deliberately withholds.

## Three hiding places — a route-map audit only finds the first

1. Route middleware.
2. **Controller `abort_unless`** (day close, deposits, 3 blind-close checks in
   PosController). Invisible to any route:list audit.
3. **Service-layer filtering** — `GlobalSearchService` asked
   `hasPermission(PRODUCTS_MANAGE)` before including a Products section, so the
   search box worked for a cashier and never found a product.

## The test that should have existed

`StaffPresetTest` asserts what a preset GRANTS. `PresetCanDoItsJobTest` (26
tests) asserts the job can be DONE — signs in as real staff behind each preset
and loads their screen. Written against capability, not permission names, with a
boundary half that fails if a future fix over-grants instead of splitting.

`CatalogTest` had a test asserting a `sales.manage` staff member got 403 from
`GET /products`. That is a cashier. **The test wrote the bug down and guarded
it.** Watch for tests that encode a bug as an assertion.

## Panel half

`deniedReason(error)` + `<NoAccess>` — a 403 says so in words instead of
rendering an empty list. `screenPermissions.ts` accepts `string | string[]`
(ANY-of) or the panel's map drifts narrower than the API.

## Deliberately NOT changed

`POST /inventory/counts/{id}/apply` stays owner-only — maker-checker: the person
who counts the shelf must not sign their own write-off, and the panel already
explains the absent button.

Business type produces NO server permission gate — it only shapes which screens
and item types appear. Cannot produce this class; verified, not changed.

Related: [[shopos-no-roles]], [[shopos-table-ownership]], [[shopos-web-completion]],
[[shopos-audit-aug06]].
