---
name: shopos-no-roles
description: ARCHITECTURE — ShopOS has no job roles; cashier/waiter/kitchen/rider are permission SETS on a staff user. Job presets ship 2026-08-07.
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-07T08:03:41.539Z
---

**ShopOS has no job roles, and this is deliberate.** `App\Enums\UserRole` has
five cases — `super_admin`, `admin_staff`, `shop_owner`, `staff`, `customer` —
and a shop uses exactly **two**: `shop_owner` and `staff`.

Cashier, waiter, kitchen, rider, manager, pharmacist are **permission sets** on
a `staff` user. There are 17 tenant permissions (`sales.manage`,
`discounts.apply`, `sales.void`, `sales.refund`, `discounts.override`,
`orders.manage`, `inventory.manage`, `expenses.manage`, `settings.manage`,
`staff.manage`, …).

**Why:** it is one authorisation path instead of two, and it lets a real shop
say "this cashier may refund, that one may not" without inventing a role for
each combination. The web panel and both mobile apps gate on
`hasPermission(...)` / `hasModule(...)`.

**How to apply:**
- Never write `if (role === "waiter")` — it compiles and is always false.
- `shop_owner` holds every permission implicitly (backend and clients both).
- Hiding UI is courtesy; the backend re-checks on every request and is the only
  authority.

## Job presets (shipped 2026-08-07)

`GET /staff/presets` → `app/Support/StaffPresets.php`. Answers "what job does
this person do?" so an owner isn't facing 17 bare checkboxes.

- **Leaves no trace.** Ticks boxes then is forgotten — only `permissions[]` is
  stored, no role column, no preset id. That is why it cannot become a shadow
  role, and why editing a preset never re-permissions existing staff.
- **Filtered per tenant** by granted modules, and by trade where the job exists
  in one trade only (pharmacist). A pharmacy never sees "Waiter".
- **No preset grants `staff.manage` or `settings.manage`** — tested for all.
- Kitchen preset states openly that it also grants the floor, because the
  kitchen board shares `sales.manage` on purpose.

Panel: preset chips on the staff form, with a recomputed "Custom" when the
ticks match no job. Related: [[shopos-relief-cover]], [[shopos-mobile-plan]].
