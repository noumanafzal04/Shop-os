# Enter in the till's search box waits for the answer to what is typed

**2026-10-07 · found while working out why a unit's serial would not scan**

## The fault — every trade

Enter in the search box added `tiles[highlighted]` there and then. The tiles
are the answer to the LAST search the server finished; a scanner types a code
and Enter in a tenth of a second, before the search for that code has been
answered. So a scanned `QA-OIL-5L` rang **the first item on the shelf** —
a phone case for a bottle of oil — and said nothing.

Only a run of five or more digits was treated as a code. A shop's own labels,
any Code-128 barcode with a letter in it, and every serial number took the
other path.

## Now

`pos/enterKey.ts` decides what Enter means, from the list's answer **to this
term** — the till remembers the Enter and acts when that answer is in:

| Term | Enter means |
|---|---|
| empty | the tile the arrow keys are on |
| five or more digits | a barcode, whatever is on screen |
| exactly an item's SKU or barcode | THAT item, not the highlighted one |
| the list has nothing for it | look it up as a code (a pack, a size, a unit's serial) |
| looks like a code (no space, a digit) | look it up as a code; if nothing carries it, the highlighted match — and the miss is not an error |
| a name | the highlighted match |

An Enter the box has moved on from is dropped, not spent on what was typed
after it.

## Tests

`enterKey.test.ts` (12), and `e2e/till-enter.spec.ts` (6) — which slows the
product list down on purpose, because standing ahead of the list is the only
honest way to stand where a scanner stands. Six browser mutations, all caught.
