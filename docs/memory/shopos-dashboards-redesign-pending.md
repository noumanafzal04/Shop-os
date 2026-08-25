---
name: shopos-dashboards-redesign-pending
description: Dashboard consistency pass DONE (one Surface, no clipped text); structure deliberately untouched — further restyling on the user's word
metadata:
  type: project
---

2026-08-26. The user gave the go-ahead ("make dashboard trendy and modern but
keep our design consistent, don't break anything") for **both** the tenant and
admin dashboards.

**First pass shipped — the design layer only:**
- `SectionCard` (shop) and `Panel` (admin) were the SAME component written
  twice and had already drifted on padding *and on the breakpoint it stepped
  at*. Both render `src/modules/dashboard/components/Surface.tsx` now.
- Every truncated label/subtitle/plan-name now wraps. "Active subscriptio…" and
  "Karahi House — cus…" were the visible ones.
- KPI strip ramps 2 → 3 → 6, waiting for `2xl` on both consoles; the emphasised
  tile lost its size bump so money is never truncated.

**Rules learned here, do not undo:**
- NEVER interpolate a Tailwind class (`` group/${name} ``) — Tailwind scans
  source text, so the class is simply never generated and the effect dies
  silently.
- Do not guess a `line-clamp` count; it was wrong at two and again at three.
  Short helper text gets no clamp.
- Verify with a sweep that compares `scrollWidth`/`scrollHeight` to the client
  box across widths — a screenshot cannot see that "Active subscriptio…" is
  wrong. See [[shopos-screen-testing]].

**Deliberately NOT done:** the page structure. The shop console is gated module
by module and trade by trade ([[shopos-no-roles]], module gates), so
rearranging it is how a pharmacy loses its batch panel. Any further restyling
is on the user's word.

**Second pass (same day) — the tile:** shop and admin had TWO tile
implementations that had drifted on the percentage itself (`−100.4%` vs
`-100.43%`). Both render `components/MetricTile.tsx` now, and `formatDelta`
lives there. Look: grey gradient wash removed, bigger tighter figure, hover
lift, sparkline to the edges.

Two more rules paid for here:
- **Never `leading-none` on text with `truncate`** — the line box becomes the
  font size and the ink gets cut. The sweep flagged every figure, "37" included.
- **An all-zero series draws nothing.** The sparkline filled the area under a
  week of zeros, so an unsold shop carried a slab of colour that reads as
  volume. The figure already says zero.
- A skeleton must render the component's OWN skeleton, never a hand-copied
  padding — they went 4px apart and the strip resized on load.

**Third pass — the VISIBLE one.** The user's feedback on passes 1–2 was "koi
changes nahi nazar aayi", and they were right: consolidation and unclipped
labels change nothing you can point at.
- `components/DashboardHero.tsx` — a brand gradient masthead on BOTH consoles,
  deliberately borrowed from the landing hero (same gradient family, faint
  grid, soft lights) so signing in looks like the page they were sold on.
  **One colour, once per screen** — everything below stays white.
- Panels: `rounded-3xl` + **a hairline under every header**. The card was one
  undivided plate, so every panel read as a soft rectangle of grey text.
- Tiles/skeletons took the same corner; two radii on a page reads as two
  designs.

STANDING lesson: internal consolidation is worth doing but is NOT what "make it
trendy" asks for. Deliver something visible in the same breath.

**Fourth pass:** KPI strips cap at **3 across** on both consoles (never 5/6 —
money in a 150px tile). `hasShape()` in `sparkShape.ts` is asked by BOTH
`Sparkline` and `MetricTile`, because the tile was reserving padding for a
drawing that had decided not to appear. `SalesTrendChart` / `ExpenseDonut` /
`RecentTables` built their own card shells and had been left behind by the
restyle — watch for those when changing `Surface`. Charts: round lineCap,
ringed hover marker, and `grid.padding.right` big enough that a round cap does
not run into the card border.

