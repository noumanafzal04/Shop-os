# Every list says which "nothing" it is

**2026-10-10 · the first of the items left on the list after the queue**

## What was wrong

A list with nothing to draw has three possible reasons: there is nothing,
the request was refused, or the request failed. The till learned to tell them
apart the day a cashier was told the shop had no products over a request the
server had answered 429. That fix was made on the till, by itself.

Every other list in the product still did it. Twenty-four screens reach
their empty cell the same way — `rows.length === 0` — and rows are
`data ?? []`. So a request that was refused, slowed down, errored or never
answered drew "No customers yet", "No suppliers yet", "No purchase orders
yet". A shop on a bad connection was told, screen after screen, that it was
empty.

## One place

All twenty-four draw that cell through one component, `<TableEmpty>`, which
exists because the same sentence was once off the side of a phone in two
dozen places. So the fix is in it, once:

    <TableEmpty from={customers} what="the customer list" colSpan={5}>
      No customers yet — they'll appear as you make sales.
    </TableEmpty>

`from` is the query the cell is the empty state of. With it the cell answers
for all three: `<NoAccess>` for a refusal (a permission, or a module the shop
has not got), `<CouldNotLoad>` with *Try again* for a failure, and the
caller's own words when there is really nothing.

**Only when there is no data at all.** A list that has its rows and whose
refresh failed is still a list with rows, and "Nothing matches these
filters" under a filter is still the truth about what is on screen.

Two more things the failed state showed up:

- On a phone the box was cut off at the card's right edge. The cell's block
  is clamped to the window, which is 34px wider than the card it sits in; a
  centred sentence is 17px off and nobody sees it, a bordered box is sliced.
- The filter bar beside it said "Counting…" for ever. It says that only
  while something is being counted now.

## So that the twenty-fifth list does not forget

`components/ui/table/emptyIsNotFailed.test.ts` reads every screen:

- every `<TableEmpty>` passes `from` (a cell that only says "Loading…" is
  the one exception, recognised by saying exactly that);
- it passes `what`, so the sentence is about this list;
- the query it is told is the one its own table waits on — a cell handed its
  neighbour's query type-checks, and would report the neighbour's failure.

And the guard checks itself: it must find at least twenty cells in eighteen
files, and must have read at least one opening tag with braces in it.

`e2e/list-failed.spec.ts` fails each of fourteen shop lists' requests and
holds the screen to saying so, in the server's words, with a *Try again*
that brings the list back. It also checks its own patterns for "what the
screen says when it IS empty" against each screen's source — "did not say X"
proves nothing about a screen that never says X.

## Not done

Lists that are not tables — cards, tiles, panels (about thirty screens:
categories, collections, bank offers, the floor, riders, reviews, the
admin's announcements and banners…) — have their own empty states and do
not go through this cell. They are the next piece of this, and need a
sibling of `<TableEmpty>` for a `<div>`.

No migration. Panel only.
