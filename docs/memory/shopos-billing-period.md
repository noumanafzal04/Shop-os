---
name: shopos-billing-period
description: BUILT + PUSHED 2026-10-10 — Billing screen has the dashboards' PeriodBar at its head (opens This month); flows follow, states don't; ledger follows until given its own dates
metadata:
  type: project
---

**The user asked (2026-10-10):** "Billing and payment screen main date picker hona chahye?" — it had one only at the bottom, on the ledger ("Any date"); the top was fixed this month / this year / all time. I answered yes and built it (they did not object; they asked for % complete meanwhile).

**Built:** `GET /admin/billing/summary?from&to` → `period` (`DashboardPeriod`, new opening `'month'` = 1st→today) + `in_period {collected, payments, shops}` as `{value, previous, delta_pct}` (`DashboardService::kpi()` now public). Panel `AdminPaymentsPage`: `PeriodBar` + `useDashboardPeriod()` + three `KpiTile`s. Money late / Chase / Subscription health / Revenue to date / 12-month trend do NOT follow.

**Rules worth keeping:**
- Collected == the ledger's total for the same dates (both cut `paid_at` start-of-from → end-of-to). Change one, change the other.
- Ledger follows the period until given its own dates: `ledgerOwn` null = following, `ANY_DATE` = every date CHOSEN (not a boolean). New period resets it. Wording in `admin/ledgerWords.ts`.
- Empty search under a period says "may be on another date" + "Search every date" — bare "nothing matches" reads as "never paid".
- The period is never "all time" (that is the ledger's control).
- `datesAreThePlatforms.test.ts` checks `<PeriodBar>` too; a page's own `today` passes only if declared from the server's date with `platformToday()` as stand-in.

Backend `a67699e`, panel `99f8818`, docs `b7efd3e`. Mutations 33/33. No migration.

Related: [[shopos-dashboard-period]], [[shopos-one-filter-bar]], [[shopos-somebody-is-working]]
