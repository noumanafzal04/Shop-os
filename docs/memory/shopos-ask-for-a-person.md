---
name: shopos-ask-for-a-person
description: Landing page's second door — enquiries table/endpoint/admin queue; a preference is not a booking; and the admin reachability guard
metadata:
  type: project
---

2026-08-25. `enquiries` shipped: public throttled `POST /api/v1/enquiries`,
admin queue at `/admin/enquiries` gated on `tenants.create`, oldest first.

**The gap it closed:** the landing page's only door was "Try the demo", which
suits whoever will try software alone. The shopkeeper who wants walking through
it, and the one with a single question in the way, both read the page and left.

**Rules that must not drift:**
- A name and an email is the whole requirement. Everything else optional.
- `prefers_at` is a PREFERENCE, never a booking. Nothing holds a slot. The
  admin card says "Wants a time around…". Do not add confirmation wording.
- `city` is a free string, never a FK — a lead has no account and will type
  "Karachi (Gulshan)".
- The panel converts the `datetime-local` value with `toISOString()` before
  sending, or `after:now` refuses a time two hours away.
- `status=all` is an explicit branch; an unknown filter is 422, never
  "everything".

**Two lessons:** the ordering test passed against its own bug twice — first by
insertion order, then because SQLite served the filtered query from the
`(status, created_at)` index. Only the UNFILTERED listing pins the clause. And
`e2e/adminScreensAreReachable.guard.ts` is now the admin twin of the shop-side
walk guard; it was wrong first (modelled only `RequireAdminScreen`, called the
deliberately-ungated Help Centre a dead row). See [[shopos-reachability-rule]],
[[shopos-detector-vs-rule]], [[shopos-the-front-door]].

**Not in the Help Centre on purpose:** `HelpCenterPage.tsx:46` returns true for
any permission when the reader is a shop owner, so an admin-only article would
show to every shopkeeper.
