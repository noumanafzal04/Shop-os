# A rail you can read, and a name of our own

**2026-08-23 · panel**

## Three things, one screen

### 1 · The collapsed rail could not be read

Most of the day the sidebar is icons with no words — that is what collapsing it
is for, and on a tablet it is the default. So a picture used twice is not a
cosmetic slip: it is two different screens that look identical at the moment
somebody is choosing between them.

Counted, across eight trades × two modes — **twenty-two collisions in sixteen
menus**:

| collision | where |
|---|---|
| POS = Sales | **all eight trades**, both modes |
| POS = Sales = Subscription | every full menu |
| Kitchen = Day & banking = Quotes | a restaurant |
| Dashboard = Dine-in | a restaurant |
| Riders = Customers | every shop that delivers |
| More = Settings | every full menu |
| Forecourt = More = Settings | a filling station |

Nobody had counted, because reading a list of icon names is not how anyone looks
at a sidebar. One picture per concept now — a table for the floor, a ticket for
the pass, a calendar for the day, a paper plane for orders — and
`navRail.test.ts` fails the moment two share.

Two more came from a pair of eyes rather than the test, and are worth recording
because the test **cannot** find them: Help Centre printed blue while every other
icon was grey (`info.svg` carried a hard-coded `#0BA5EC`), and Branches wore the
same cube as Products — different components, near-identical drawings. A check
that compares component names is blind to that by construction.

### 2 · Simple mode did not know what the shop does

The calm view was one list for everybody, gated on MODULES only. So:

- a restaurant had **Dine-in and no Kitchen** — the pass, on the other wall;
- a workshop had **Products and no board** — the screen its whole day is;
- a chemist had **no dispensing register**;
- a filling station had **no forecourt**.

Every one of them a screen those shops open first and close last. "Daily
essentials" was being read as a fixed list when it is a per-trade question.

The trade's own daily screen now appears in BOTH modes, from one definition, so
the two views cannot disagree about what a shop's daily work is. `More` keeps
what it should have kept all along: the back office, and the counter lookups a
trade reaches for with a customer standing there.

Simple ⊆ Full still holds and is still pinned — Simple is a smaller menu, never
a different business.

### 3 · Two controls for one action

The sidebar header carried a collapse button: the same three-bar icon the app
header already has, four centimetres from its twin, doing the identical thing.
Two controls for one action is not twice as convenient; it is a question about
whether they differ. The header's survives — it is reachable whether the sidebar
is open or shut, and the sidebar's was not.

## CartZe

The product has a name and a domain (`cartze.shop`), so the panel wears it: 105
strings, the manifest, the app icons, and a `<title>` — of which there had been
**none at all**, so the tab said "localhost". A till is one of half a dozen tabs
open on a shop's computer all day and that line is the only thing telling them
apart.

**The wordmark is a component, not an .svg**, and the reason generalises: an SVG
loaded through `<img>` is its own document. It does not inherit the page's font,
cannot fetch Outfit from Google Fonts, and knows nothing about dark mode — which
is exactly why there were two files, forever one edit apart. Rendered inline it
is text in the page: the app's own typeface, the theme through a token, one file
to change.

`app-icon.svg` and its maskable twin are kept beside the PNGs as sources, so the
next size is re-rendered rather than re-drawn. The maskable one is a separate
drawing, not the same file relabelled — Android crops it to the launcher's shape.

## Appearance

The rail tab was a square with a gear in it, and a gear on the right edge of a
business dashboard could be almost anything. Hovering now widens it and the word
arrives, so nobody has to click to find out; the gear turns a quarter while that
happens. **The width animates, not the position** — a tab that slides in from the
edge on hover is a tab that moves out from under the pointer aiming at it.

Save had three states and one appearance, with a literal `✓` inside the label —
same weight as the word beside it, arriving in a single frame, on the one control
whose entire job is confirming that something happened. Now: a spinner while it
saves, an arrow-into-tray at rest, and a tick that **draws itself** over 340ms.
Reduced motion keeps the tick and drops the journey, which is the point of the
setting.
