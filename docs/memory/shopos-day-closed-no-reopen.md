---
name: shopos-day-closed-no-reopen
description: SHIPPED 2026-10-07 — today's closed day can be opened again (reason, whoever may close it, one trail line); never yesterday's, never once trading moved on
metadata:
  type: project
---

Was OPEN (a closed day took no shift and had no way back). The user said to build the best answer; built and pushed.

**What exists:** `ReopenBusinessDayAction` + `POST /pos/days/{day}/reopen {reason}`; `GET /pos/day` returns `meta.closed_today` (id, date, closed_at/by, branch, sales_total, `can_reopen`) when nothing is trading; panel `ClosedTodayCard` on Day & banking; journey stage I (`e2e/journey/13-…`).

**The fences (each has a test and a mutation):**
- only a day dated >= `ShopDay::today()` → `BUSINESS_DAY_TOO_OLD` otherwise;
- only while no LATER day exists at that branch → `BUSINESS_DAY_MOVED_ON`;
- `Permissions::SUPERVISES_TILLS` (same as close) — a cashier sees the day named with no button;
- a reason, min 3.

**Effects:** status open, frozen totals cleared (summed again at the proper close from ALL shifts), shifts untouched, `reopened_by/at/reason` kept on the row (migration `2026_10_07_000001`), ONE `reopened` audit row with the old sign-off as `old_values` (model auditing suppressed for that update).

**How to apply:**
- The journey no longer skips on a same-day run: stage G's `openShift` opens the day again via `reopenToday()` in `e2e/journey/till.ts`. Same-day full run = 105/105 + stage I.
- `candidateAnywhere()` exists because a single-branch owner is ALWAYS in the all-branches view (no X-Branch-Id) — the first version offered the way back only to chains.
- A relation named `reopenedBy` serialises over the `reopened_by` column (same as `closed_by`): assert `data.reopened_by.id`.

Decision: `docs/decisions/shopos-a-day-closed-by-mistake.md`. Related: [[shopos-shop-day]], [[shopos-which-day-is-open]]
