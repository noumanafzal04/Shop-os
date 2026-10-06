# A receipt set to a roll prints on a roll

**2026-10-06 · reported from the counter**

> "Receipt main thermal 80mm select hai to POS screen main print wo size ni
> niklta — A4 size e hota hai."

## Why

Every roll template wrote `@page { size: 80mm auto }`. That is not CSS. A
page's `size` is one length, two lengths, or a named sheet; "a length and
auto" is none of them, so Chrome and Safari drop the declaration and print on
the printer's default sheet. Measured in both: the same receipt came out
216 mm wide with `80mm auto` and 80 mm wide with `80mm 200mm`.

Four templates had it — receipt, Z-read, quotation/advance (the kitchen ticket
named no size at all) — plus the hardware "Test print", which had its own
window and its own copy. So pressing Test print to find out why receipts were
wrong printed a test page that was wrong in the same way.

The receipt test that existed asserted the page contained the string
`size: 58mm auto`. It was green for as long as the bug was there.

## The rule

A roll has a width and no length, and CSS cannot say "as long as it turns
out". So:

- **Server** (`PrintPaper`): the one place a page size is said. As wide as the
  roll, as long as an A4 sheet — valid on its own — plus `data-roll-mm` and
  `data-roll-margin-mm` on `<html>`.
- **Panel** (`fitRoll` in `common/print.ts`): the one door every document is
  printed through measures the laid-out receipt and replaces the page with
  `size: 80mm <N>mm` — two lengths, rounded UP, with a few millimetres for
  the cutter. The frame it is laid out in has the roll's real width; a frame
  of no width gave a receipt of the wrong height.

A two-item sale is a short slip and a forty-item one is a long slip.

## Tests

- `ARollIsARollTest` asks what a browser will accept, not what string is on
  the page; a template that sizes its own page fails a guard.
- `e2e/till-print.spec.ts` rings a sale, presses Print, catches the document
  handed to the printer, and prints THAT document to a PDF with the engine's
  own idea of its page: 80 mm × one slip, 58 mm, and 210 × 297 for A4.

## What this cannot fix

The printer's own driver. If it is set to a fixed sheet it feeds a blank
tail whatever the page says; Help tells the shop where to change it.
