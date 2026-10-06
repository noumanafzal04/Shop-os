# A line can change until it is sent

**2026-10-06 · "the person taking the order… that screen also does not look
good. This will be mostly used on a tablet."**

## What a waiter could not do

A tab had two verbs: add a line, void a line. Every tap on a dish added one
line of one, and the whole menu was disabled until the answer came back.

- Eight naan was eight taps, eight rows on the tab, and **eight rows on the
  kitchen's docket** — "1 Roghni Naan", eight times, for the cook to count.
- "Make that three" could not be said.
- "No green chilli" could not be said at all. `note` has been on the line
  since the first day; the API accepted it; **no screen ever sent one.**

## The third verb

`PATCH /restaurant/tickets/{tab}/items/{line}` — `{adjust?, note?}`.

- **Only while the line is `pending`.** Once fired it is a thing a cook is
  making; the docket is printed. Refused with `ITEM_ALREADY_SENT`. After that
  the honest verbs are the two the tab always had.
- **A step, never a target.** `adjust: 1`, not `quantity: 4`. Four quick taps
  on shop wifi are four requests that each say "one more" and all arrive at
  four in any order. Four that each said "make it N" from what the screen
  last saw arrive at two. The row is locked while it moves.
- **Down to nothing is a void** — the same void `voidItem` writes.
- **Re-priced, not multiplied.** A tiered price depends on how many, and a
  percentage discount is a share of the new gross. `AddTicketItemsAction::priced`
  is the one piece of arithmetic for both adding and stepping; a line reached
  by stepping costs what the same line costs added in one go (tested against
  a tier).
- More of a dish that has since run out is refused; fewer never is.

## On the screen (`useTabLines`)

Taps are **queued, never refused**. Each is decided when its turn comes,
against the tab as the server last described it: an unsent line of exactly
this order is stepped, otherwise a line is added. Deciding at the moment of
the tap would have eight taps all looking at a tab with no naan on it.

What "exactly this order" means (`tabLines.joinable`): same dish, same size,
same extras — and **never a line with a note**. "No chilli" was said about
one karahi; a second tap joining it would tell the kitchen to make two
without.

The tab is drawn as the three piles a waiter keeps in their head — Not sent
yet (the only lines with controls), In the kitchen, Served — and the big
button is the next thing to do: Send to kitchen while anything is unsent,
Settle when nothing is.

Side by side from `md` (a tablet in either hand); one pane at a time on a
phone. The menu pane needs `min-w-0`: its row of section chips does not wrap,
and without it the pane pushed the order — total and all — thirteen pixels
off the side of a tablet.

## Tests

`ATabLineCanChangeBeforeItIsSentTest` (15; 16 mutations, 15 caught, one
equivalent — the framework already trims input), `tabLines.test.ts` (9),
`food.tab-order.spec.ts` at three sizes: three real taps → one line of three
→ the cook's card says 3 once, with the note. Mutated (taps never join) and
it fails.
