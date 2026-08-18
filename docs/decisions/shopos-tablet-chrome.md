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

---

## 2026-08-18 · the Appearance panel opened underneath the shell

Three more complaints off the same tablet, and — again — one number:

> the close X sits under the top header and can't be tapped ·
> the sidebar comes over the body · the header runs across from the left

All three were the Appearance canvas being **below the chrome it was covering**.
It lived in its own little z-band while the shell lives three orders of
magnitude higher:

| | |
|---|---|
| Appearance rail button / scrim / canvas | `z-60` / `z-70` / `z-80` |
| App header | `z-99999` |
| Drawer backdrop | `z-100001` |
| Sidebar drawer | `z-100002` |

On a desktop nothing overlapped, so it looked fine. On a tablet — where the
sidebar **is** a full-height drawer and the header is sticky across the top —
the canvas opened underneath both. The panel was drawn, and the header and the
drawer were drawn on top of it: the X was covered, the sidebar printed over the
page, and the header ran across the panel from the left edge. Three symptoms, no
error, one cause.

The scrim is now `z-100003` and the canvas `z-100004`. The scrim matters as much
as the panel: a scrim ranking below the header leaves the header **live and
tappable in front of a modal**, which is the same bug wearing the other half's
clothes.

The rail button stays at `z-60` deliberately — it is a launcher, not a modal,
and it should sit behind any dialog rather than float over one.

`tabletChrome.test.ts` gained the rule ("opens ABOVE the shell, not underneath
it"), checked the only way worth checking: reverting the fix turns it red.

**The pattern, three for three now.** Every tablet complaint in this file has
been the same shape — *one question, answered in more than one place, and the
answers drifted.* Three widths for one breakpoint; a hard-coded header height
beside a real one; and now a stacking order maintained in two bands that never
met. None of them errored. All of them were invisible on the machine they were
built on.

---

## 2026-08-18 (later) · four more off the same tablet

All reported from a shop's own device, and none of them visible on a desktop.

**The Appearance close was 28px.** `p-1` around a 20px glyph, in the top-right
corner of a panel pinned to the right edge of the glass. A mouse forgives 28px;
a thumb at the edge does not. Now `size-11` — 44px, the floor — and `shrink-0`,
because it shares a flex row with a title and a sentence of help text and was
otherwise the thing that gave when the text was long.

**POS tiles read as transparent.** `bg-white/[0.10]` on the `#212a45` pane is
about four percent of luminance between the card and the page it sits on. On a
desktop panel that reads as a card; on a tablet held at an angle under shop
lighting it does not, and the shop described the products list as "transparent,
text showing through" — which is exactly what a card whose edge you cannot find
looks like. The pane's own comment already said what the tile should be — *"the
tile IS the content, so it should be the brightest thing on it"* — and at 10% it
was not. Now `bg-white/[0.16]`, hover `0.24`, border raised to match so the edge
is seen rather than inferred.

**The totals bar was eating the tablet's height.** Eight figures in two rows of
four, each with a label, at desktop padding. Nothing is dropped — every one of
those numbers is something a cashier gets asked to read out — but the padding
and row gap now tighten below `lg` and return at desktop.

**Quick keys are off small screens**, on the shop's request. Worth recording the
trade rather than losing it quietly: a mart's loose lines — tomatoes, rice by
the kilo, chai — have no barcode, and that strip was the fast route to them. On
a tablet they are now reached through search or the category filter, which is
slower per item. One class (`hidden lg:block`) puts them back.

## Modals had no shadow at all

Separately, and not tablet-specific: `Modal`'s panel was
`rounded-3xl bg-white dark:bg-gray-900` — **no shadow, no ring** — behind a 30%
scrim. A white sheet on a white page with nothing but a corner radius to say it
is in front. The shop's phrasing was that modals were "not opening properly",
which is what a dialog with no edge looks like when you cannot tell it from the
screen underneath.

`shadow-2xl` plus `ring-1` now: the shadow lifts it in light mode, the ring does
the work in dark, where a shadow against a near-black page is invisible and only
a lighter edge can separate two dark surfaces. The scrim goes 30% → 50% (dark
50% → 65%).

**No blur was added, and that is deliberate** — the existing comment records
that a 32px `backdrop-blur` made every modal open feel sluggish and buried the
page in fog. That finding stands. The objection was to the *blur*, not to the
opacity, and a darker scrim costs nothing at paint time.

