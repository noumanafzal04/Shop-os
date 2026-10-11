---
name: shopos-dashboard-period
description: BUILT + PUSHED 2026-10-09 — both dashboards take ?from&to; DashboardPeriod owns compare/series; flows follow the period, states are NOW; today ≠ period; opening period = absence of params
metadata:
  type: project
---

**User asked (2026-10-09):** date range on the dashboard, admin AND tenant —
today, yesterday, week, month, last month, quarter, custom; reuse the existing
filter; "achi jagah, bura na lage"; default today or current week.

**Shipped** — backend `636cc53`, panel `5daf1e1`, docs `a534049`. Decision:
`docs/decisions/shopos-a-dashboard-is-asked-about-a-period.md`.

**The rules (do not re-derive):**
- `App\Support\DashboardPeriod` = the arithmetic for BOTH consoles. Compare is
  LIKE FOR LIKE: 1–9 Oct vs 1–9 Sep (salary-day effect: the days before the 1st
  are the poorest), whole month vs whole month, quarter/year likewise, else the
  same number of days before. Chart: day ≤31, week ≤120, then month; ONE day =
  the 7 ending on it.
- Flows follow the period; STATES are now (low stock, owed, pipeline, floor,
  bay, till block, hero line). `today` key is ALWAYS today; `period` is new.
- **No params = the old payload exactly** (partner/ phone app reads it:
  today · week · month's breakdown + leaders). The panel ALWAYS sends dates.
- Opening period = ABSENCE of `?from&to` (follows the clock; picking it again
  un-pins). Shop that sells → today; books-only → this month; platform → last 7.
- Platform period is cut on UTC (like billing); the console takes `today` from
  the payload. A running period is compared with the same PART of the one before.
- Panel labels come from the PAYLOAD's `period`, not from what was asked
  (`modules/dashboard/period.ts`); `PeriodBar` sits above the KPI strip.

**Things that bit (mine):**
- `whereBetween(date_col, [from, to])` on SQLite drops the last day — the
  column holds "…-09 00:00:00". Spell both ends to the second, as ReportService does.
- `toLocaleDateString("en-GB",{month:"short"})` is "Sept". Use the app's own list.
- On the 1st, "This month" == "Today"; on the 7th, "Last 7 days" == "This
  month". A spec must not assert a preset's NAME on a date-dependent preset —
  `last_7`/`last_30` win by menu order and are safe.
- 3 mutation survivors were real: a UTC-cut that only shows on the FIRST day
  read (needs a 01:30 sale there + `day_turns_at: 0`), "customers" counting
  staff, and stepping back from the 1st.

**Not done (said in the decision):** hour-by-hour for one day; platform trend
charts do not follow the period; billing/audit "Today" still uses the laptop's
date vs UTC; shop header overflows a 320px screen by 24px (pre-existing).

Related: [[shopos-one-filter-bar]], [[shopos-shop-day]], [[shopos-today-in-utc]],
[[shopos-dashboard-rail-theme-oct06]], [[shopos-queue-oct09]]
