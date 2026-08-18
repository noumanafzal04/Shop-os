---
name: shopos-who-sold-it
description: "sales.served_by — who SOLD a sale vs who rang it; never inferred, off by default, seller list rides /pos/sellers not /staff"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-16T18:19:56.104Z
---

**Shipped 2026-08-16** (audit item 17, found by reading the RETAIL trade).

`staffPerformance` grouped sales by `created_by` and the panel titled it
**"Staff performance"** — two different claims. One-person shop: correct.
Showroom floor (garments/shoes/electronics): salesmen work the customers, one
cashier types, and the cashier was credited with everybody's month.

`sales.served_by`, nullable. Report now has "Who sold it" / "Who rang it up" /
unattributed.

**Invariants not to break:**
- **Never inferred.** An unattributed sale stays unattributed. Falling back to
  the cashier IS the defect; a test asserts the cashier never appears as a
  seller for an unnamed sale.
- **The POS box is never pre-filled** with the signed-in user, for the same
  reason.
- **Off by default** (`pos_ask_who_served`) and absent, not disabled. It is a
  shop-SHAPE question, not a trade one — showroom and tyre shop want it, kiryana
  and bakery never will, and both pairs cross trade lines.
- **Seller list rides `GET /pos/sellers` + the cached catalog, NOT `/staff`** —
  a cashier holds `sales.manage`, not `staff.manage`. One private method
  (`PosCatalogController::sellerList`) feeds both so they can't drift. See
  [[shopos-read-vs-manage]].

**Deliberately not built:** commission/targets, and split credit between two
salesmen.

Full reasoning: `docs/decisions/shopos-who-sold-it.md`.

Related: [[shopos-retail-depth]], [[shopos-no-roles]], [[shopos-unit11-status]].
