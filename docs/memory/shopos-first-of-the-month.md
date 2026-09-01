---
name: shopos-first-of-the-month
description: STANDING — 3 times the suite went red on a month boundary; period=monthly is the CALENDAR month and fixtures dated now()->subDay fall out of it; scripts/clock-dependent-tests.py
metadata:
  type: feedback
---

Three times the suite has gone red for a reason that had nothing to do with the
product:

| | |
|---|---|
| 2026-08-31 | `AutoWorkshopTest` — "6 yr 2 mo" became "6 yr 1 mo" |
| 2026-08-31 | `BillingSaysHowMuchTest` — 800.0 became 0.0 |
| 2026-09-01 | `StockReportsTest` ×4 + `PosSyncTest` — a monthly report found no sales |

Same shape every time: a fixture dates itself **relative to now**
(`now()->subDay()`, `subDays(2)`) while the thing under test asks a
**calendar-windowed** question. `resolvePeriod` makes `monthly` mean
`startOfMonth`→`endOfMonth`, not "the last thirty days". Sell yesterday, report
today, and on the 1st those are different months.

**It does not look like a flake.** Four tests fail at once, all in one file, all
about a report — and the report is fine. Worse here: the machine runs **UTC+5
while the app runs UTC**, so the suite crosses the boundary at seven in the
evening and "it passed this morning" is true and useless.

**How to apply:**
- `$this->travelTo('2026-06-15 10:00:00');` in `setUp` — mid-month, so a fixture
  a few days back stays in the same window.
- Before blaming your own change, `git stash` and re-run: that is what proved
  these five were failing on committed code.
- `scripts/clock-dependent-tests.py` catches the fourth one. Its FIRST version
  flagged two files that use a relative past as a QUERY BOUND
  (`'from' => now()->subDay()`), which only widens the window and is safe —
  sharpened to ignore lines that are asking rather than dating.

Related: [[shopos-measurement-that-lied]], [[shopos-detector-vs-rule]],
[[shopos-the-machine-slept]].
