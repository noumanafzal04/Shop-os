---
name: shopos-nothing-here-off-screen
description: FIXED — a table's empty-state message was centred in the TABLE (384px) not the WINDOW (390px), so a phone showed an empty white box
metadata:
  type: project
---

2026-09-04. Every list is a table in `overflow-x-auto` with `min-w-[48rem]`.
The empty row was `<td colSpan className="text-center">`, so at 390px the
message centred at 384. Measured before: purchases 474px, customers 485px,
coupons 402px. **All of them pass on desktop**, which is where they were
looked at.

Fixed by `src/components/ui/table/TableEmpty.tsx` — the message sits in a
`sticky left-0 w-full max-w-[100cqi]` block. **28 cells, 26 files.**

**The CSS worth remembering:** a container query length (`cqi`) falls back to
the SMALL VIEWPORT when no `container-type` is declared above it. So
`max-w-[100cqi]` clamps to a screen width on a phone and does nothing on
desktop — no wrapper edits, and where `cqi` is unsupported the declaration is
simply invalid and the old behaviour returns.

**The guard's blind spot, which matters more than the bug:**
`e2e/empty-state.spec.ts` empties each list by intercepting its request and
blanking `data`. Two of six patterns were wrong (`/api/v1/tenant/sales` vs
`/api/v1/sales`) — and `/tenant/transfers` **PASSED anyway**, because that
fixture genuinely has no rows. A guard green by accident is one you never look
at again. It now counts interceptions and asserts the count first: *"never
asked for the list this test blanks — the pattern is wrong"*. **A pattern that
matches nothing must not read as a screen with nothing to say.**

Related: [[shopos-responsive-backlog]] · [[shopos-detector-vs-rule]] ·
[[shopos-outcome-not-coverage]] · [[shopos-screen-testing]] ·
[[shopos-shell-widened-the-page]]
