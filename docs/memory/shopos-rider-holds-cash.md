---
name: shopos-rider-holds-cash
description: FIXED — a rider carrying the shop's COD cash could be deleted; the cause was having no way to edit a rider
metadata:
  type: project
---

2026-10-02. `cash_in_hand` on `/tenant/riders` = delivered, paid cash, not yet
settled. `DELETE /riders/{id}` was a plain soft delete, so the row left the
list and the money with it: `index`, `/statement` and `/settle` all read a LIVE
rider. The orders keep their `rider_id` so nothing is lost in the database, but
there is no way back to it from the panel. Now `422 RIDER_HOLDS_CASH` naming
the amount.

**The cause is the ninth instance of the recurring shape.** `PATCH /riders/{id}`
has accepted `name` and `phone` since the module was written; the screen sent
only `is_active`. So correcting a typo meant *remove and re-add* — which is how
a row with cash on it gets deleted. Edit is on the row now; without it the
refusal is a dead end.

Tests: `backend/tests/Feature/TheRiderIsHoldingTheCashTest.php` — 5 cases, two
of them denominators (a rider holding nothing goes; a settled rider goes),
because a delete that refuses everybody is a worse bug.

Note: `DomainException`'s code lands at **`meta.error_code`**, not `error.code`.
`ApiResponse::noContent` returns **200**, not 204; settle returns **201**.

Related: [[shopos-four-doors]], [[shopos-rider-side]], [[shopos-pay-the-door-nobody-tested]]
