---
name: shopos-one-filter-bar
description: site-wide filter kit + named date ranges; the pager bug proved "two copies of one rule, newer one missing the fix"
metadata:
  type: project
---

2026-08-26. Built `src/components/ui/filters/` — the one filter treatment for
the whole panel: `FilterBar` (search + controls + **removable applied pills** +
Clear all + result count), `DateRangeFilter` (named ranges **with the dates
they resolve to**, two-month custom dialog, nothing applied until Apply),
`FilterChips`, `FilterSelect` (native `<select>` on purpose — better on a
phone), `FilterPopover`. Arithmetic lives in `dateRanges.ts`, pure, 19 tests.

Rolled onto ~14 screens both sides. Also shipped: `tenants.converted_at` +
`Tenant::origin()` (demo / converted / direct) so the admin list can find an
owner who pressed **Keep this shop**; `GET /admin/inbox` badging the rail with
who is waiting; a rebuilt Billing page that says **how much** is late (per-plan,
grace vs overdue, shops with no plan counted apart) and who to ring today.

**Why:** the user said "the whole site's filters don't look good" — true, and
the smaller half. The larger half was filters the servers had accepted since
they were written that no screen ever sent (tenants: status/city/plan/online;
billing: tenant/from/to; sales: channel/from/to). The sales Help Centre article
had promised filtering "by date, payment method or who rang it" over a server
with only the date.

**How to apply:**
- New list screen → use the kit. Never hand-roll a filter row again.
- URL-backed filters → `nextParams` / `useUrlFilters` ONLY. See
  [[shopos-page-rule-one-copy]].
- Any facet count is taken with the other filters applied and **not its own**.
- A count withheld by permission is an **absent key**, never zero.
- Never `toISOString()` for a calendar date — UTC shift starts every range a
  day early in Karachi.
- Before writing a filter, check what the endpoint already accepts. Four
  endpoints here were richer than their screens.

Related: [[shopos-page-two]], [[shopos-page-two-per-list]],
[[shopos-promise-in-another-file]], [[shopos-the-aisle]],
[[shopos-shell-widened-the-page]].
