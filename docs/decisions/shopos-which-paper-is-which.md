# Which paper is which

**2026-10-06 · reported from a restaurant's counter, with a picture**

> "POS invoice kitchen ki receipt ki tarah nikal rahi — why? Jo setting main
> save krty wo ni arhi."

The picture was the print window: KITCHEN in a box, KOT #1, TAKEAWAY, three
dishes, no prices — cut across two pages, the last "+ Mild" alone on the
second.

## What it was

Not the invoice. A counter sale in a shop with a kitchen does two things: it
takes the money, and it fires a kitchen ticket. A kitchen that works off
paper has the ticket printed the moment the sale is paid (`kot_auto_print`,
on by default); the customer's receipt is printed when asked for
(`pos_auto_print`, off by default). So the first window to open after
"Complete sale" is the kitchen's slip — and nothing anywhere said so. The
header, footer, logo and paper size saved under Settings → Receipt were "not
on it" because it was never the receipt.

Three faults under that one sentence, and a fourth beside it.

| Fault | Now |
|---|---|
| Nothing said whose paper it was | The sale sheet: "Kitchen slip #1 sent to the printer. That one is for the kitchen — no prices on it. The customer's invoice is Print receipt." The slip itself: "KITCHEN COPY — NOT A RECEIPT" |
| The slip was cut across two pages | A roll is measured at the width the words will have on paper (see below) |
| The slip printed itself on load, and with both auto-prints on one paper could be dropped | One print at a time; the receipt first; a document may not print itself |
| The roll invoice looked like a kitchen slip too: the same typewriter face | A document's face, black ink, a title band, a ruled total |

## The measuring rule (why the slip was cut in two)

`fitRoll` gives a roll a page exactly as long as what is printed on it. To do
that it lays the document out in a hidden frame and measures it. The first
version made the frame as wide as the ROLL, on the theory that the printed
layout is the wider of the two and wraps less. True for the receipt. Backwards
for the kitchen ticket: its lines are large and nearly as wide as the paper,
the printed page was narrower than the screen, and a dish name that fitted one
line on screen took two on paper. The page was cut for the shorter layout.

So: **a roll document is laid out the same on screen and on paper.** No page
margin; five millimetres of its own padding on every side; any width a
template pins for the screen is let go while it is measured. Then what is
measured is what prints.

## The edge (why invoices were "stuck to the edges")

A thermal head is narrower than its paper — an 80mm roll prints about 72mm —
so a 3mm page margin was already inside what the printer cannot reach. And a
page margin is the print window's to take away: with "Margins: None" chosen
there once, a margin written in CSS is discarded. Padding belongs to the
document. `PrintPaper::ROLL_EDGE_MM` (5) is the one place it is said.

## Tests

- `e2e/food.kitchen-slip.spec.ts` rings a counter sale in the restaurant and
  reads every document handed to the printer, in order: one kitchen slip, on
  one page, saying whose it is; then the invoice when asked for; and with
  auto-print on, receipt before slip, both arriving.
- `print.test.ts`: the measuring width, no self-printing documents.

## Left alone

Whether a counter sale should print the customer's receipt by default. It
does not: most counters hand the receipt over only when asked, and the switch
is one line in Settings. The sheet now makes the choice visible either way.
