---
name: shopos-header-would-not-yield
description: 5 trade e2e projects opened 9 never-walked screens; 7 of 9 failed on ONE header bug (nothing in the row could shrink); the sideways-scroll rule named the wrong culprit twice more
metadata:
  type: project
---

2026-08-25. Nine screens sat behind a trade the mart fixture does not have —
forecourt, fuel deliveries, tanks & pumps, dispensary, bay board, vehicles,
warranty, reservations — and had **never been opened by a browser**. Five
projects added, one per trade, signed in as the matching QA-sweep shop.

**First walk: 7 of 9 failed, all the same bug.** `1298px of content in a 1280px
window`. AppHeader's row had nothing willing to give way: the right-hand
controls are `shrink-0` on purpose, and the search box was pinned at
`xl:w-[430px]`. A shop whose header carries one control more than the mart's
made every one of its screens scroll sideways.

Fix: `min-w-0` on the search wrapper + `xl:max-w-[430px]` instead of a fixed
width. **A search box that narrows is fine; a page that scrolls sideways is
not.**

**The rule named the wrong culprit twice more** (four total — two were already
in its docblock):
- it skipped `position: fixed` elements but NOT their children, so the closed
  appearance drawer parked off-screen right was blamed on every screen;
- a parent stretched by a child reaches EXACTLY as far as the child, and
  document order puts the parent first — `>` kept naming containers. Now `>=`
  with the deepest winning a tie.

**Why the docblock mattered:** because the two earlier misattributions were
written down, the third and fourth were recognised as the same shape in minutes
instead of believed. See [[shopos-promise-in-another-file]].

Same pattern as [[shopos-screens-nobody-opened]] and the restaurant project
([[shopos-docket-outlived-tab]]): the screens nobody looks at are the ones
nothing is measured against.

Doc: `docs/decisions/shopos-a-header-that-would-not-yield.md`.
