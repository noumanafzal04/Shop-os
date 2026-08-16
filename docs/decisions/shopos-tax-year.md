# The tax year — July to June

**Decided 2026-08-16.** Found by reading the FINANCE trade during the
business-type audit; recorded in `docs/audit-2026-08-12/VERIFIED.md` as item 16.

## The problem

Every "yearly" window on this platform meant **1 January – 31 December**:

- `App\Services\ReportService::resolvePeriod` — `'yearly'`
- `src/modules/expenses/reportPeriod.ts` — `resolveReportRange`
- `src/modules/expenses/services/moneyFilters.ts` — `presetRange`

Grepping `fiscal|tax_year|financial_year` across both applications returned
nothing.

**FBR's tax year runs 1 July – 30 June.** The annual return, the audited
accounts, and every advance-tax working under s.147 are prepared against that
window. A calendar-year total is a figure that is never submitted anywhere.

Nothing was broken — the numbers were right, the date boxes could always express
any window by hand. The shortcut simply could not express the one window that a
business here is legally measured by.

It matters most to the **Finance Manager** tenant, which has no catalog, no
stock and no till. On that tenant the books screen is the entire product, so a
date shortcut is not a convenience there.

## The decision

**Add a second button. Do not replace the first.**

A shopkeeper asking *"is saal kitna kamaya"* usually does mean January to
December — that is a real question and taking it away to hand them their
accountant's year would be answering something they did not ask. Two windows,
two questions, two buttons.

- Report screens: `period=tax_year` alongside `period=yearly`.
- Money screens (expenses / income / ledger): a `Tax year` preset alongside
  `This year`.
- Granularity is `month`, like the calendar year — twelve months of daily
  buckets is not a chart anybody reads.

## Where the rule lives

`app/Support/TaxYear.php` — `TaxYear::containing(CarbonImmutable $day)`,
mirrored by `taxYearRange()` in `src/modules/expenses/reportPeriod.ts`.

**A test asserts the two mirrors agree to the day.** This exact pair has already
drifted once in this codebase: the panel started a week on Sunday while Carbon
started it on Monday, so two tabs of one screen reported different weeks with
nothing on either saying so.

The boundary is the whole feature: **30 June closes the year that began the
previous July; 1 July opens the next one.** One day either side is a different
return. Both sides derive the end date by adding a year and stepping back a day,
never by hard-coding a month length.

## Deliberately not done

**Not a per-tenant setting.** July–June is statutory here, this platform is
PKR-only and Pakistan-only, and a setting that 99% of tenants must never touch
is a setting the other 1% gets wrong. The rule is stated once in `TaxYear`,
which is what a configurable year would need anyway if one were ever genuinely
wanted.

**No change to quarters.** Calendar quarters and tax-year quarters fall on the
same four boundaries (Jul–Sep, Oct–Dec, Jan–Mar, Apr–Jun) — only the numbering
differs. Adding a second quarter control would have been noise.

**No "Tax year 2026" label.** FBR numbers a tax year by the year it ENDS, which
is a trap worth avoiding entirely: the buttons carry the dates beneath them, and
`1 Jul 2025 – 30 Jun 2026` is unambiguous to everybody.

Related: [[shopos-expense-manager-gaps]], [[shopos-business-priority]].
