# The menu and the door answered differently

**2026-08-23 · panel**

## What was wrong

A shop's Kitchen job preset grants `kitchen.manage` and nothing else. That is
the whole point of it: the permission was split out of `sales.manage` on
2026-08-10 so a kitchen hand need not be shown the shop's takings in order to
mark a curry ready.

Four surfaces offered them the kitchen board — the sidebar, the dashboard tiles,
the trade panel, a notification's deep link — because all four read
`screenPermissions.ts`, where the rule is `["sales.manage", "kitchen.manage"]`.

The route guard required `sales.manage` and sent them to the dashboard.

**The one screen their job is made of, offered and refused by the same app.**

## Why it could not have been expressed correctly

`RequirePermission` took `permission: string`. App.tsx named the rule again in
**27 wrappers**, and a prop holding one string cannot say "either of these". So
every screen whose rule is ANY-of had drifted, and all four were wrong in the
same direction — the guard held the narrowest of the alternatives:

| screen | the map, and the server | the guard |
|---|---|---|
| `/tenant/kitchen` | `sales.manage` OR `kitchen.manage` | `sales.manage` |
| `/tenant/suppliers` | + `purchases.manage`, `inventory.manage` | `suppliers.manage` |
| `/tenant/purchases` | + `inventory.manage` | `purchases.manage` |
| `/tenant/activity` | + `reports.view` | `settings.manage` |

Checked against `route:list`, not against the map: `READS_KITCHEN`,
`READS_SUPPLIERS`, `READS_PURCHASE_ORDERS` and `READS_AUDIT` are exactly the
sets the map holds. **The map was right every time. The fifth copy was the one
that was wrong, and nothing compared them.**

## The fix

`RequireTenantScreen` takes no prop. It reads its own location and asks the map,
resolving a url to the screen that governs it — longest mapped ancestor, matched
by SEGMENT, so `/tenant/documents/{id}` inherits `/tenant/documents` while
`/tenant/salesmen` inherits nothing.

That is what `RequireAdminScreen` has always done on the other console; its own
docblock says why — "read from the same map the rail and the dashboard shortcuts
use, so all three can only ever agree." The shop side never got the same
treatment.

Verified equivalent-or-widening before believing it: no route lost a gate, no
non-tenant route gained one, and every guarded route has a governing rule.

## What now holds it

- `tenantScreenGate.test.tsx` — 12 tests. The general form is the one that
  matters: **for every screen in the map, somebody holding any one of its
  permissions gets in.** A gate honouring only the first is as broken as the
  kitchen one, just not noticed yet.
- The same file asserts App.tsx names no permission of its own. A guard taking a
  permission prop is the regression returning, whatever it is called.
- `screenPermissions.test.ts` checked only the FIRST name against the list of
  permissions the server defines — so `kitchen.manage` sat there unlisted and
  unchecked. It now checks every name.
- `docs/qa/screen-permission-drift.py` — the cross-repo half. The map's docblock
  promises "the permission named here is the one the SERVER asks for", and
  nothing had ever checked it. 40 of 43 screens quote a rule the server really
  has; 3 are named exceptions with reasons; `--prove` plants a drift and fails
  if it is missed.

## The shape, for next time

A rule with five copies is not five chances to be right. The four that agreed
were the sidebar, the dashboard, the deep-link resolver and the Help Centre —
all reading one map — and the fifth was hand-written beside the routes. **The
copy that drifts is the one written in a different file by a different author on
a different day**, and it drifts toward whatever was true when it was written.
