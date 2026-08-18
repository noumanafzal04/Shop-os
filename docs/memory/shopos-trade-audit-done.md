---
name: shopos-trade-audit-done
description: "The eight trade areas are CLOSED (audit items 14-22, 2026-08-16). Don't re-run the trade-by-trade read."
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-17T11:16:20.378Z
---

**All eight trade areas read and closed on 2026-08-16**: mart, services, food,
pharmacy, retail, automotive, petroleum, finance. Recorded as items **14–22** in
`docs/audit-2026-08-12/VERIFIED.md` (15 is the follow-on to 14).

| # | Trade | Finding |
|---|---|---|
| 14/15 | petroleum | unbilled litres owed by nobody → `attendant_id`; then the column shipped unreachable |
| 16 | finance | "this year" was the calendar year → [[shopos-tax-year]] |
| 17 | retail | "Staff performance" measured who typed → [[shopos-who-sold-it]] |
| 18 | pharmacy | expired stock could leave but not be accounted for → [[shopos-stock-disposals]] |
| 19 | food | a dish costed from a hand-typed number → [[shopos-recipe-cost]] |
| 20 | mart | purchase price recorded at every delivery, never propagated → [[shopos-moving-cost]] |
| 21 | automotive | no per-trade dashboard panel; "ready, not billed" existed nowhere |
| 22 | services | `job_card` was never trade-fenced — only its screen was |

**Six of the eight had ONE shape: the answer was already in the database and
nothing read it.** No script finds these — nothing was missing, nothing errored,
every figure on screen was correct.

**Don't re-run this pass.** If a new trade is added, read that one.

Two rules that came out of it and generalise:
- **Unknown is not zero** (disposals, recipe cost, moving cost).
- **A capability is not shipped until something a person touches can reach it** —
  found 6× in this codebase, once with me as the author.

Related: [[shopos-audit-backlog]], [[shopos-business-priority]].
