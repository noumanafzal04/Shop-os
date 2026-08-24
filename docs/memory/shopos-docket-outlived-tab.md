---
name: shopos-docket-outlived-tab
description: FIXED — cancelled tabs left their kitchen dockets on the pass forever and inflated the owner's kot_waiting; one shared scopeForAnOpenTab; e2e now has a RESTAURANT project
metadata:
  type: project
---

Fixed 2026-08-24. A cancelled tab left its KOT rows `fired` on the kitchen board
**forever**. Measured on a real shop's pass: 9 dockets, **8 belonging to voided
tabs**, two fired six days earlier. A cook was being told to cook meals nobody
would eat or pay for.

The dashboard was worse: `kot_waiting` counted `whereNull('served_at')` with NO
status filter at all, so it grew by one every time anybody cancelled anything
and never came down.

**How to apply:**
- One rule: `KitchenTicket::scopeForAnOpenTab()`. Both the board
  (`KitchenController::boardQuery`) and `DashboardService::diningFloor` read it.
  Two readers of one fact is two chances for one to forget the tab.
- **Cancel WRITES `void` on its dockets** — a known fact. Anything already
  `served` is left alone: cancelling a bill cannot un-cook food.
- **Settle writes NOTHING.** A tab being paid says nothing about whether the cook
  pressed Ready; writing `served` would put a claim in the kitchen's record the
  kitchen never made. The BOARD judges instead: a closed tab is not work.
- Tests: `CancelledTabLeavesThePassTest` (6). 3 mutations proven, each caught by
  a different test.

**How it was found — the standing lesson.** The e2e fixture shop is a MART, so
the floor/tab/kitchen board had **zero** browser coverage. There is now a
`restaurant` playwright project signed in as `sweep-food-restaurant@qa.test`
(food + inventory + dine_in), with `e2e/.auth/food.json` and `foodAuth()`.
Specs matching `food.*.spec.ts|recipe-size.spec.ts` run ONLY there
(`RESTAURANT_ONLY` testIgnore on the other four projects).

The bug surfaced only because the fixture had to put a REAL ticket on the pass —
an empty board passes every layout rule. See [[shopos-large-uses-more]] for
`e2e/skipReporter.ts`, which is what made "no food spec can ever run" visible.

**Fixture traps hit, all four (see [[shopos-fixtures-that-breed]]):** take a FREE
table not `tables[0]`; `fire`'s response `data` IS the kots array; register
cleanup the moment the tab EXISTS (not on success) and run it from `afterEach`,
or a failing run strands an open tab on a real floor; `kot_number` is a per-tab
sequence so every card says #1 — identify by TABLE name.
