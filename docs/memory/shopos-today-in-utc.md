---
name: shopos-today-in-utc
description: STANDING — new Date().toISOString().slice(0,10) is yesterday before 05:00 in Karachi; use toIsoDate(); guarded by common/format/localDate.test.ts
metadata:
  type: feedback
---

`new Date().toISOString().slice(0, 10)` was spelled by hand in **11 places
across 9 files**. In Karachi (UTC+5) every moment before 05:00 local is still
yesterday in UTC, so between midnight and five in the morning:

- a new expense defaulted to **yesterday's** date
- the `max` on the date box **refused today**
- "this month" started on the **last day of the month before**

`toIsoDate()` in `src/components/ui/filters/dateRanges.ts` has existed for
exactly this reason and reads the date in the viewer's own timezone.

**Why:** nobody notices — the shop is usually shut, and the entry looks
plausible read back. It is the same defect this codebase has met three times
(see [[shopos-other-half-of-a-date]]).

**How to apply:** never derive a `yyyy-mm-dd` through `toISOString()`. Use
`toIsoDate(date)`. `src/common/format/localDate.test.ts` is the lint rule that
enforces it (with a denominator, and mutation-proven).

Sibling: `formatEntryDate(iso)` in the same module is the one copy of "how a
date is written on a row" — Today / Yesterday / 24 Aug / 24 Aug 2025.
