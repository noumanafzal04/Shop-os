# The dashboard says one thing; the rail is in three parts

**2026-10-06 · "Dashboard thora UI or better… sidebar b thori better krdo",
with two screenshots of another product as a direction, not a template**

## The dashboard

- **The band says the one thing to know** (`shop/status.ts`). It carried a
  greeting and a date — two things the reader already had. Now: the most
  pressing thing that is TRUE, in urgency order (food on the pass → an order
  not accepted → a day left open → the kitchen → the floor → out of stock →
  low stock → "everything is moving"). Every sentence is read off a figure;
  "moving" is only said once something has sold.
- **What a shop does first is under the band** (`QuickActions`): four tiles,
  ranked for the trade, filtered by module and permission. They were nine
  pills at the foot of the page. The rest stay there ("More shortcuts").
  With no `show` prop the component renders all of them, which is what the
  reachability guard renders — no offer can hide behind a prop.
- **One filled card**: today's sales (or money in, for a books-only shop) in
  the shop's colour, the week behind it as bars, today's solid.
- The band shows the shop's own **logo** when it has one. Not the rail — a
  shop card was tried there and taken out the same day at the owner's word.

## The rail

- Three parts under headings — Daily work, Manage, Your shop
  (`NavItem.section`). A heading is drawn where the section CHANGES, so a row
  filed in the middle of another part would print a second heading;
  `navSections.test.ts` holds each part in one piece for every trade and view.
- **Where you are is a solid plate** in `--rail-primary` — the first shade of
  the shop's ramp that carries white at 4.5:1.
- **The "black line"**: opening a group makes the menu longer than the rail,
  and its scroller's thumb was `gray-700` on any rail carrying `dark` — which
  the PRIMARY rail does. On the shop's own colour that was a near-black
  stripe appearing with every submenu. The submenu's guide line was
  `gray-800` for the same reason. `.rail-scroll` shows a thumb only while the
  rail is in use, coloured for its ground; `.rail-guide` is white-on-colour.
- An opened group is scrolled into view.

## Tests

`status.test.ts` (11), `QuickActions.test.tsx` (6), `MetricTile.test.tsx`
(4), `navSections.test.ts` (36), `chrome.spec` at four sizes (171). 24
mutations, 23 caught; the survivor is equivalent (`hasShape` already keeps a
flat week from reaching the bars).
