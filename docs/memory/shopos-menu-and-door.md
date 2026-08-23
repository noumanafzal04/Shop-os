---
name: shopos-menu-and-door
description: FIXED — the Kitchen preset was offered the kitchen board by 4 surfaces and bounced by the route guard; RequirePermission held ONE string so no ANY-of rule could be written there
metadata:
  type: project
---

Four surfaces decide whether to **offer** a shop screen — sidebar, dashboard
tiles, trade panel, notification deep link — and all four read
`screenPermissions.ts`. A fifth decided who actually **gets in**: 27
`<RequirePermission permission="…">` wrappers in `App.tsx`, each naming the rule
again by hand.

A prop holds one string, so the four screens whose rule is ANY-of could not be
expressed there at all, and every one had drifted to the narrowest alternative:

- `/tenant/kitchen` — `sales.manage` only. **The Kitchen preset grants
  `kitchen.manage` and nothing else**, which is the entire reason the permission
  was split out. Offered the board, then redirected to the dashboard.
- `/tenant/suppliers`, `/tenant/purchases` — the stockroom half missing.
- `/tenant/activity` — `reports.view` missing.

Checked against `php artisan route:list`: **the map matched the server every
time.** The hand-written copy was the only wrong one.

Fixed by `RequireTenantScreen` — no prop, reads `useLocation()`, resolves the url
to the longest mapped ancestor **by segment** (so `/tenant/salesmen` never
inherits `/tenant/sales`). This is what `RequireAdminScreen` already did on the
admin console; the shop side never got it.

Held by `tenantScreenGate.test.tsx` (12 tests; the general form — every screen,
every one of its permissions, gets in) and `docs/qa/screen-permission-drift.py`,
which compares the map against the server across both repos: 40/43 agree, 3 named
exceptions, `--prove` fails if the planted drift is missed.

**The shape:** a rule with five copies is not five chances to be right. The four
that agreed all read one map. See [[shopos-read-vs-manage]],
[[shopos-promise-in-another-file]], [[shopos-no-roles]].
