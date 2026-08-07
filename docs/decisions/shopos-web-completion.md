---
name: shopos-web-completion
description: "2026-08-07 DIRECTIVE — finish the web side first, excluding offline; settings-orphan sweep shipped 4 fixes; only waiter scoping + training mode remain"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-07T13:07:10.601Z
---

**Directive (2026-08-07): complete the WEB side first, excluding offline.**
Mobile Phase 0 is paused mid-flight for this. Offline PWA POS and
deployment/CI-CD stay parked for last.

## Two audits, run instead of answering from memory

**Dead endpoints: zero.** Every tenant route has a panel caller.

**Inert settings: 4 of 57 keys.** All shipped:

- **`max_discount_percent` / `max_discount_amount` had no field.** Enforced in
  `CreateSaleAction` + `CreateSaleDocumentAction` since they shipped, with
  `discounts.override` existing to exceed them — but unreachable, so both sat
  `null`, the ceiling was infinite and the permission guarded nothing. Blank
  still = no limit, which is why it stayed silent.
- **`tips_enabled` was inside the dine_in-gated Kitchen card** → own card. A
  salon or delivery shop could never switch tips on.
- **`stock_age_warn_years` / `stock_age_old_years`** read by `BatchController`,
  no field. Trade-gated to `automotive` — age from a DOT week, NOT expiry;
  labelling it expiry in a pharmacy would be dangerous.
- **`delivery_provider` deleted** — declared, validated, read by nothing.

## Two lessons worth keeping

**The endpoint probe lies if it matches whole paths.** It reported 45 orphans,
all false: the panel builds URLs from template literals (`/products/${id}/images`).
Match the longest *literal* segment. This trap has now produced a fake audit
result twice.

**Do not enforce `tips_enabled` server-side.** I tried; it broke 4
`FoodServiceTest` cases and the premise was wrong — a tip is added to `$due`, so
the money IS in the drawer and `DrawerMath` expects it. There is no shortage to
prevent. It is a client prompt toggle like `pos_auto_print`.

## Remaining on the web

**Training mode only** — ranked last. Waiter floor scoping SHIPPED 2026-08-07,
see [[shopos-table-ownership]].

Multi-lane is already done: `registers` (one per checkout, own printer/drawer/
shift), owner-created, `registers` limit defaults to **2** per tenant and an
admin raises it.

Related: [[shopos-loose-ends-aug07]], [[shopos-build-sequence]],
[[shopos-food-dinein]], [[shopos-no-roles]], [[shopos-deployment]].
