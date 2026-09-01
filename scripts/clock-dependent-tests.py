#!/usr/bin/env python3
"""
TESTS THAT WILL FAIL ON THE FIRST OF A MONTH.

Three times now the suite has gone red for a reason that had nothing to do with
the product:

    2026-08-31  AutoWorkshopTest       '6 yr 2 mo' became '6 yr 1 mo'
    2026-08-31  BillingSaysHowMuchTest  800.0 became 0.0
    2026-09-01  StockReportsTest ×4     a monthly report found no sales
    2026-09-01  PosSyncTest             a cashier vanished from the staff report

Every one of them is the same shape. A fixture dates itself RELATIVE to now —
`now()->subDay()`, `subDays(2)`, `subMonths(6)` — and the thing under test asks
a CALENDAR-WINDOWED question: `period=monthly` is `startOfMonth` to
`endOfMonth`, not "the last thirty days". Sell yesterday, run the report today,
and on the 1st those are different months.

It is worse than a flake, because it does not look like one. Four tests fail at
once, all in the same file, all about a report — and the report is working
perfectly. An afternoon goes into the wrong place before somebody notices the
date. This machine makes it likelier still: it runs at UTC+5 while the app runs
UTC, so the suite crosses the boundary at seven in the evening local time and
"it passed this morning" is true and useless.

The fix is one line — `$this->travelTo(...)` in `setUp` — and the point of this
script is that nobody has to notice the date to know they need it.

Run:  python3 scripts/clock-dependent-tests.py
Exit: 1 when a test file has the hazard and does not pin its clock.
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TESTS = ROOT / "tests"

# A fixture that dates itself by counting backwards from whenever the suite runs.
RELATIVE_PAST = re.compile(r"now\(\)->sub(?:Day|Days|Week|Weeks|Month|Months|Year|Years)\b")

# A question whose answer is bounded by a CALENDAR unit rather than a rolling
# window. `resolvePeriod` is the authority: monthly is startOfMonth→endOfMonth.
CALENDAR_WINDOW = re.compile(
    r"period=(?:weekly|monthly|yearly|tax_year)"
    r"|startOfMonth|startOfYear|startOfWeek"
    r"|resolvePeriod\("
)

# `'from' => now()->subDay()` is a question, not a fixture: asking about a
# WIDER window than the calendar unit cannot make a sale fall outside it.
QUERY_BOUND = re.compile(r"'(?:from|to|start|end)'\s*=>")

# The one line that makes the hazard harmless.
PINNED = re.compile(r"\$this->travelTo\(|Carbon::setTestNow\(|freezeTime\(")


def main() -> int:
    files = sorted(TESTS.rglob("*Test.php"))
    hazardous: list[tuple[str, str, str]] = []
    pinned = 0
    scanned = 0

    for f in files:
        src = f.read_text()
        scanned += 1

        # A relative past used as a QUERY BOUND is safe — `'from' =>
        # now()->subDay()` only widens the window it is asking about. The
        # hazard is a relative past used to DATE something: a sale sold
        # yesterday, a shift opened two days ago. The first version of this
        # script could not tell them apart and reported two walkthroughs that
        # are in no danger at all.
        dating = "\n".join(
            line for line in src.splitlines()
            if not QUERY_BOUND.search(line)
        )

        past = RELATIVE_PAST.search(dating)
        window = CALENDAR_WINDOW.search(src)
        if not (past and window):
            continue

        if PINNED.search(src):
            pinned += 1
            continue

        hazardous.append((str(f.relative_to(ROOT)), past.group(0), window.group(0)))

    # THE DENOMINATOR. A scanner that examined nothing reports a clean bill of
    # health, and this one has a regex for a filename pattern that could stop
    # matching the day somebody renames a directory.
    print(f"{scanned} test files scanned")
    print(f"{pinned} carry the hazard and PIN their clock")
    if scanned < 100:
        print("\nthe scan found almost no test files — it is looking in the wrong place,")
        print("not celebrating a suite that has none")
        return 1

    if not hazardous:
        print("\nEvery test that dates a fixture backwards and asks a calendar-windowed")
        print("question pins its clock.")
        return 0

    print(f"\n{len(hazardous)} test file(s) will fail on the first of a month:\n")
    for name, past, window in hazardous:
        print(f"  {name}")
        print(f"      dates a fixture with `{past}` and asks `{window}`")
    print("\n  Add `$this->travelTo('2026-06-15 10:00:00');` to setUp — mid-month, so")
    print("  a fixture dated a few days back stays inside the same window.")

    return 1


if __name__ == "__main__":
    sys.exit(main())
