# The page behind an overlay holds still

**2026-09-04.** Shop's words: *"sidebar scroll bhi issue kar raha / body scroll
ho rahi tab pe / body bhi kuch sidebar niche aa rahi."*

---

## What was actually wrong

Two separate things, both about the same rule and neither of them the sidebar's
own markup — which is why reading `AppSidebar.tsx` found nothing.

**1. The drawer locked nothing.** Measured in WebKit at 810 and at 390, with the
menu open:

```
window.scrollBy(0, 400)                    →  scrollY 0 → 400
getComputedStyle(document.body).overflow   →  "visible"
```

**2. The menu's own list handed its scroll to the page.**

```
nav overscroll-behavior-y                  →  "auto"
```

Reach the last menu item and the gesture carried on into the dashboard behind
it. On iOS that also produces the rubber-band that reads as "the sidebar is
sliding".

## The part that makes it a design note, not a patch

`src/components/ui/modal/index.tsx` **did** lock the page —
`document.body.style.overflow = "hidden"` — and had done for as long as the
modal has existed. So the app answered "what happens to the page behind an
overlay?" in two places, and one of the two answers was "nothing".

That is the shape worth remembering: not a missing feature, but **one rule
implemented at one of its two call sites**. The drawer was never written
wrong; it was never written at all.

## Why `overflow: hidden` was not the fix

It is the half-fix that passes a test and fails a finger.

`overflow: hidden` on `<body>` stops a scripted `window.scrollBy` in every
engine — so a spec that scrolls by script goes green. iOS Safari scrolls the
document anyway on a real drag: the body is not the scrolling element there,
the visual viewport is. A guard written against the scripted gesture would have
signed off on a build the shop could still break with a thumb.

`src/layout/scrollLock.ts` takes the body **out of flow** instead —
`position: fixed`, offset up by however far the page had been scrolled — which
leaves the viewport nothing to scroll on any engine. The offset is what stops
the page jumping to the top when the menu opens; restoring the scroll on
release is what stops it jumping back when the menu closes.

It is **reference counted**. Two owners can hold it at once (a drawer open, a
modal opened from inside it), and both used to write `document.body.style`
directly — so whichever closed FIRST unlocked the page for the one still open.

## The guard

`e2e/overlay-scroll.spec.ts`, and it asserts the mechanism as well as the
effect, on purpose — see above for why the effect alone is not enough.

Both halves of the branch assert something real: below `DRAWER_BELOW` it opens
the drawer and holds the page; at or above it, where the rail is pinned and no
overlay exists, it asserts the body is **not** locked, so a lock that is never
released fails somewhere.

Denominator: the dashboard must be scrollable by more than 200px before
"the page did not scroll" means anything.

Mutation-proven — `lockScroll()` made unreachable:

```
✘ an open drawer holds the page behind it still
  Error: the body is still in flow, so an iOS drag will scroll the page behind the menu
```

and `overscroll-contain` removed:

```
✘ the sidebar's own list does not hand its scroll to the page
  Error: reaching the end of the menu carries on into the page behind it
```

## One thing the test taught about the layout

The first version closed the drawer by clicking the header's "Toggle Sidebar"
button again. It hung for the full five-minute timeout: the scrim is at
z-100001 and the header at z-99999, so with the menu open that button is
deliberately unreachable. Playwright refusing to click through the overlay was
the layout answering correctly. The spec now closes it the way a shop does — a
tap on the scrim.
