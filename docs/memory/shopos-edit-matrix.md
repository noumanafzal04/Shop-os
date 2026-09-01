---
name: shopos-edit-matrix
description: STANDING — an edit must change what it named and NOTHING else; two scanner findings (15 untested PUT/PATCH, 19 always-supplied fields) collapse into this one question
metadata:
  type: feedback
---

**An update has a failure mode a create does not: it can quietly change
something nobody asked it to.** The suite created things everywhere and edited
them almost nowhere — 15 write routes no test posted to, **14 of them PUT or
PATCH**, and 13 of the 19 "optional field every test supplies" sat on those same
routes. One question covers both:

- the field it NAMED holds the new value
- every other column is byte-identical
- and it was not REFUSED for fields the caller had no reason to resend

The third is a finding, not an error: an endpoint that demands the whole record
back to change one field is how a screen sends stale values over fresh ones.

**Found** (`tests/Feature/EditMatrixTest.php`, 12 endpoints):

1. **A coupon could not be edited one field at a time** — `update()` used the
   STORE request. Every comparable resource had its own update request; coupons
   did not, and it was invisible because the screen sends the whole form. *A
   screen's habit is not a contract.*
2. **A fixed promotion could not be raised above Rs 100** — the update request
   read `type` from the INPUT with a default of `percent`, so a rupee amount was
   validated against a percentage ceiling, naming a field the shop was not
   changing. Fixed by `ValidatesAgainstTheStoredRecord`: **a partial update is
   validated against the record as it WILL BE**, so the missing half comes off
   the row, never off a default.

**How to apply:** exclude `updated_at`/`updated_by` — an audit stamp whose job
is to move is not "something nobody asked about". Compare `getAttributes()`, and
check relations separately (a collection's `item_ids` is invisible to a column
diff). Mutation-prove by making one update blank a field it was not sent.

Related: [[shopos-day-and-chorus]], [[shopos-outcome-not-coverage]],
[[shopos-half-a-rule]].
