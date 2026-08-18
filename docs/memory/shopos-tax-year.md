---
name: shopos-tax-year
description: Pakistani tax year (1 Jul – 30 Jun) added as a report/books period beside the calendar year; rule lives in App\Support\TaxYear + reportPeriod.ts mirror
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-16T18:01:14.655Z
---

**Shipped 2026-08-16** (audit item 16, found by reading the FINANCE trade).

Every "yearly" window meant 1 Jan – 31 Dec, in all three places that compute
one, and `fiscal|tax_year|financial_year` grepped to nothing across both apps.
**FBR's tax year runs 1 July – 30 June** — the annual return, audited accounts
and advance-tax workings all sit inside it, so a calendar-year total is a figure
nobody submits.

- `App\Support\TaxYear::containing()` is the rule; `taxYearRange()` in
  `src/modules/expenses/reportPeriod.ts` mirrors it, and a panel test asserts
  the two agree to the day (this pair drifted once before over week-start day).
- `period=tax_year` on reports; `Tax year` preset on expenses/income/ledger.

**Decisions not to revisit:**
- **Added, never substituted.** "Is saal kitna kamaya" usually does mean the
  calendar year. Two questions, two buttons.
- **Not a per-tenant setting** — July–June is statutory, platform is PKR/PK-only.
- **Quarters unchanged** — calendar and tax-year quarters share boundaries.
- **No "Tax year 2026" label** — FBR numbers by the ENDING year, which is a
  trap; the dates under the button settle it instead.

Full reasoning: `docs/decisions/shopos-tax-year.md`.

Related: [[shopos-expense-manager-gaps]], [[shopos-audit-backlog]].
