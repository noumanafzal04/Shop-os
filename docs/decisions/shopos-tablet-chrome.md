# The shell at tablet width — one breakpoint, and a viewport that exists

**2026-08-17.** Four symptoms came off one tablet. Two causes, and both are the
same mistake: a number written down more than once, then drifting.

## What the shop reported

> "sidebar b proper work ni kr rhi tab py"
> "top header k sth overlap ho rhi thi"
> "X close ni ho rhi thi"
> "appearance canvas … uska save ka button [ni] show ho raha tha"

## Cause 1 — three widths for one question

"Is the rail pinned, or is it a drawer?" was answered in three places:

| Where | Width |
|---|---|
| `SidebarContext` | `innerWidth < 768` |
| `AppHeader.handleToggle` | `innerWidth >= 1024` |
| every class in `AppSidebar` and `AppLayout` | `lg:` = **1024** |

Between 768 and 1023 the answers disagreed — and that band is not an academic
edge. **It is a tablet held upright**: iPad 820, iPad Pro 11" 834, iPad 10.2"
810. Every one of them landed in the gap where the JavaScript believed it was
looking at a desktop and the stylesheet knew it wasn't.

What that produced:

- The rail was off-canvas (CSS said *drawer*) while the state said *expanded
  desktop*.
- `handleResize` force-closed the drawer on **every** resize event. On a tablet
  browser a resize fires when the address bar slides away — i.e. the moment you
  scroll. Open the menu, scroll, it shuts.

**Fixed:** `DRAWER_BELOW = 1024` is exported from `SidebarContext` and read by
the header. It is the number already compiled into the stylesheet, not a
preference. Only a real crossing *into* pinned territory closes the drawer.

## Cause 2 — the drawer measured the header

`mt-16 h-[calc(100dvh-4rem)]` — a hard-coded belief that the header is exactly
64px tall. Below `lg` the header is 64px with the account menu shut and roughly
140 with it open, and **on a tablet that menu is the only route to
notifications, branch and profile**, so it is open often. Open it and the
header — z-99999 against the rail's z-50 — printed itself over the top of the
nav.

The X compounded it: the only way out was the header's toggle, a control in
another component. A drawer you can open and not close is a trap.

**Fixed:** the drawer is `inset-y-0 h-dvh`, stacks above the header
(`z-100002`, `lg:z-50` once pinned, scrim at `z-100001`), carries **its own**
close, and closes on navigation. No header measurement can be wrong because no
header measurement is taken.

Two smaller ones in the same pass:

- **Hover-to-peek is for a mouse.** Touch fires `mouseenter` on tap and often
  never fires `mouseleave`, so the rail latched open at 290px and reflowed the
  page beside it. Gated on `(hover: hover) and (pointer: fine)`.
- **The pinned rail starts collapsed below 1280.** A tablet in landscape is
  1024–1194; the rail took 290 of it, leaving ~734px of page — phone width on a
  screen the shop thinks of as large. Initial value only; once the user has an
  opinion, resizing never overrules it.

## Cause 3 — `h-screen` on a panel with a footer

`ThemeCustomizer` is a flex column: header, a scrolling middle, and a footer
holding **Reset and Save**. `h-screen` is `100vh` — the *large* viewport, the
height the page would have if the address bar were hidden. It isn't hidden. So
the column was laid out taller than the glass and the overflow went off the
bottom edge, which is exactly where Save lives. Nothing scrolled to rescue it:
the middle is the only scroller, by design.

A merchant could change every colour in their shop and had no Save to press.

**Fixed:** `h-dvh`, the height that actually exists, which is the unit the rest
of the app already uses. Header and footer are `shrink-0`.

## The rule

> **A width that decides layout is stated once. Anything that needs it reads it.**

Three copies at three values is not a style problem; it is a device the product
does not work on.

## Guard

`src/layout/tabletChrome.test.ts` — 10 assertions, source-text rules rather than
renders. They cannot prove the tablet *looks* right; they prove the specific
arithmetic that broke it cannot quietly come back. Mutation-checked: reverting
each of the three fixes fails its own assertion and only its own.

Related: [shopos-mobile-design](shopos-mobile-design.md), [shopos-ui-conventions](shopos-ui-conventions.md).
