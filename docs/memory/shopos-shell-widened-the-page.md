---
name: shopos-shell-widened-the-page
description: FIXED — AppLayout's flex-1 column had no min-w-0, so one wide table pushed the whole page sideways, only at xl and up
metadata:
  type: project
---

2026-08-26. `AppLayout`'s content column was a plain `flex-1`. A flex child's
default `min-width: auto` refuses to shrink below its own content, so **one
table wider than the window pushed the entire shell — header included — past
the right edge of the page**. The page scrolled sideways, and a sideways page
has no visible scrollbar: the only symptom is that the last column of the table
is not there.

It only appeared at `xl` and up, because that is where `min-h-screen xl:flex`
becomes a flex row at all; below it the same markup is a block and behaves. So
the **widest** screens were the broken ones — the opposite of where anyone
looks for a layout bug. Both consoles were affected; found on
`/admin/audit-logs` at 1440.

**Why:** jsdom has no layout engine, so 1198 unit tests could never see it. A
browser probe at four widths found it in one run.

**How to apply:**
- Fix is `min-w-0` on the flex child; guarded by
  `src/layout/shellDoesNotWiden.test.ts` (mutation-proven).
- Any new flex row holding page content needs `min-w-0` on the content side.
- Measure `documentElement.scrollWidth - clientWidth` at 1440/1280/1024/768/390
  when touching layout. Skip SVG internals and `.apexcharts-*` — chart
  internals are false positives.

Related: [[shopos-screen-testing]], [[shopos-tablet-chrome]], [[shopos-header-would-not-yield]].
