---
name: shopos-shell-widened-the-page
description: min-width:auto is the whole bug class — AppLayout's flex-1 (Aug-26) and MetricCard in a grid (Sep-01); plus how to PROBE for it correctly
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

## 2026-09-01 — the same fault, in a card

`MetricCard` had no `min-w-0` either. As a GRID item the default is the same
`min-width: auto`, so a long money value did not overflow the card — it widened
the column, then the grid, then the page:

```
div.grid ... xl:grid-cols-6   scrollW=974  clientW=942
  div.rounded-2xl (a card)    scrollW=205  clientW=135
    h4 (the money value)      scrollW=181  clientW=87
```

`Rs 2,358,634.50` wants 181px; the card had 135. Six across only ever fit
because the numbers had been small — a change that made revenue count
partially-refunded sales took the fixture to seven digits and it stopped
fitting. So this is a **latent** bug that any shop reaching seven figures would
have hit.

**PROBE FOR IT THE RIGHT WAY.** Two of three probes measured the wrong thing:
listing elements whose right edge exceeds the viewport found only the Appearance
drawer — `position: fixed`, off-canvas, and contributing NOTHING to document
overflow. The question that works is:

```js
el.scrollWidth > el.clientWidth   // which box is too small for its own content
```

not "what is widest". Different questions; only the second finds this.

**How to apply:**
- Fix is `min-w-0` on the flex child; guarded by
  `src/layout/shellDoesNotWiden.test.ts` (mutation-proven).
- Any new flex row holding page content needs `min-w-0` on the content side,
  and so does any GRID or FLEX item that holds a number a shop could grow.
- A row of money cards at six across is 135px each at 1280 — too narrow for PKR
  figures. Four across.
- Measure `documentElement.scrollWidth - clientWidth` at 1440/1280/1024/768/390
  when touching layout. Skip SVG internals and `.apexcharts-*` — chart
  internals are false positives.

Related: [[shopos-screen-testing]], [[shopos-tablet-chrome]], [[shopos-header-would-not-yield]].
