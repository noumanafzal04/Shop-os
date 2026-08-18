---
name: shopos-relief-cover
description: "2026-08-07 SHIPPED — relief cover; the design rule is \"a cover moves the queue, not the drawer\" (sell yes, reconcile never)"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-07T07:06:30.770Z
---

Relief cover shipped 2026-08-07 (backend 1279 green, panel 109). A cashier can
step away without the lane stopping: someone else takes the till, rings under
their **own** name, and the drawer stays the responsibility of the cashier who
will count it.

`POST /pos/session/cover` · `/cover/end`. Table `cash_session_covers`.

**The rule: A COVER MOVES THE QUEUE, NOT THE DRAWER.** Cover grants the right to
SELL, never the right to RECONCILE. A reliever cannot close the drawer
(`COVERING_ANOTHER_DRAWER`), cannot pay in/out of it (`COVER_CANNOT_MOVE_CASH` —
only `no_sale`, to make change), and is never shown its opening float or
expected cash.

**Why:** grant both and it is just a handover with extra steps, and two people
end up accountable for one physical box. Before this, a ten-minute break meant
stopping the lane, counting the drawer out, or letting the reliever ring under
the absent cashier's login — the counter picks the third, and it makes every
stamp on those sales a lie.

**How to apply:**
- Figures freeze at hand-back, live while the cover runs — same rule the day
  view uses for open shifts, same reason a Z-read freezes.
- The cashier's own PIN ends the cover (`TillIdentityController::unlock`). It is
  the gesture a counter will actually make. Unlock also returns
  `cover_available` so the POS offers a cover instead of a REGISTER_BUSY dead end.
- Nobody holding their own drawer may cover another (`ALREADY_ON_A_SHIFT`).
- `ended_at === null` IS the open state — no status column beside it, same
  pattern as warranty claims' `resolution`.
- Panel: `/pos/session` returns one of three shapes; narrow with `isCover()`.
  A reliever's sale quotes the CASHIER's `session_id`, never the cover's own id.

Related: [[shopos-audit-aug06]], [[shopos-hardware]], [[shopos-pos-ux]].
Remaining from the same P2 list: **training mode** only, ranked last.
