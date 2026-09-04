---
name: shopos-page-behind-overlay
description: FIXED — the sidebar drawer locked nothing while the modal always had; one rule, two call sites, done at one
metadata:
  type: project
---

2026-09-04. Shop: *"sidebar scroll bhi issue kar raha / body scroll ho rahi tab
pe."* Measured in WebKit at 810 and 390 with the drawer open: `scrollBy(0,400)`
moved the page 400px, `body` overflow was `visible`, nav
`overscroll-behavior-y` was `auto`.

**The shape:** `components/ui/modal` had locked the page since forever. The
drawer never had. Not a missing feature — **one rule implemented at one of its
two call sites.** Look for the other call site whenever a rule is found broken.

**Why `overflow: hidden` was refused:** it stops a scripted `window.scrollBy` in
every engine and does NOT stop a real drag on iOS Safari (body isn't the
scroller there). The cheap fix passes a spec and fails a thumb. So
`src/layout/scrollLock.ts` takes the body OUT OF FLOW (`position: fixed`, offset
by scrollY, restored on release) and is **reference counted** — two overlays can
hold it; the LAST one releases. Both used to write `document.body.style`
directly, so whichever closed first unlocked the page for the other.

Guard `e2e/overlay-scroll.spec.ts` asserts mechanism AND effect, and both halves
of the width branch assert something (at ≥1024 the body must NOT be locked, so a
leaked lock fails somewhere). Mutation-proven.

Test lesson: closing the drawer via the header toggle hung 5 minutes — the scrim
is z-100001 over a z-99999 header, so it is deliberately unclickable. Playwright
refusing to click through the overlay was the layout being right. Close it with
a tap on the scrim, the way a shop does.

Related: [[shopos-half-a-rule]] · [[shopos-promise-in-another-file]] ·
[[shopos-screen-testing]] · [[shopos-detector-vs-rule]]
