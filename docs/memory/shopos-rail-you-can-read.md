---
name: shopos-rail-you-can-read
description: FIXED — 22 icon collisions across 16 menus (POS = Sales in all 8 trades); and Simple mode was gated on modules so a restaurant had Dine-in and no Kitchen
metadata:
  type: project
---

Two sidebar defects, both found by MEASURING rather than by reading the code.

**The collapsed rail could not be read.** Eight trades × two modes, every
top-level icon compared: **22 collisions in 16 menus.** POS = Sales in all eight
trades; a restaurant showed one picture for Kitchen, Day & banking and Quotes;
every full menu had POS = Sales = Subscription. The rail is icons-only by design
and the default on a tablet — so that is two different screens looking identical
at the moment somebody chooses between them. `navRail.test.ts` now fails if two
top-level items share an icon.

**Its limit, written into its own docblock:** it catches "two items reference the
same icon", NOT "two icons look alike". Both remaining problems were found by
looking at a screenshot — Help Centre printed blue (`info.svg` had `#0BA5EC`
hard-coded instead of `currentColor`), and Branches wore the same cube as
Products. Different components, same drawing. See [[shopos-detector-vs-rule]].

**Simple mode did not know what the shop does.** It was one list gated on MODULES
only, so a restaurant had Dine-in and no Kitchen, a workshop had Products and no
job board, a chemist had no dispensing register, a filling station had no
forecourt — in every case the screen that shop opens first and closes last.
"Daily essentials" is a per-TRADE question, not a fixed list. The trade's daily
screen is now defined once (`tradeDaily` in AppSidebar) and used by both modes,
so the two views cannot disagree about what a shop's day is. Simple ⊆ Full still
holds and is still pinned.

Also removed: the sidebar's own collapse button, identical to the header's and
four centimetres from it. The header's is reachable whether the sidebar is open
or shut; that one was not.
