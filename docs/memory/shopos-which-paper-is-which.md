---
name: shopos-which-paper-is-which
description: FIXED 2026-10-06 — "POS invoice looks like a kitchen receipt" was the KOT auto-printing; roll documents: no page margin, 5mm own padding, measured as printed; one print at a time
metadata:
  type: project
---

User report + screenshot (restaurant "Karahi House"): print window showing KITCHEN / KOT #1 / dishes without prices, cut across two pages. They took it for the invoice.

**Why:** a counter sale in a shop with a kitchen auto-prints the KITCHEN ticket (`kot_auto_print`, default ON); the customer's receipt prints only on "Print receipt" (`pos_auto_print`, default OFF). Nothing said which paper was which. Same Courier face on both made the roll invoice look like a kitchen slip too.

**How to apply (rules that now hold):**
- A ROLL document is laid out the SAME on screen and on paper: `@page margin: 0`, `PrintPaper::ROLL_EDGE_MM` (5mm) of its own padding on every side. A page margin can be removed by the print window's "Margins: None", and 3mm was inside what an 80mm head can print. Never rely on `@page margin` for a roll.
- `fitRoll` (panel `common/print.ts`) measures at the paper's width with screen-only things removed (`.no-print`, `has-toolbar`, pinned `width`). Measuring wider than it prints CUTS THE SLIP IN TWO — that was a regression I shipped the same day ([[shopos-roll-is-a-roll]]).
- `printHtmlDocument` queues: one print window at a time, receipt BEFORE kitchen slip. A document must not print itself (`onload="window.print()"` is stripped).
- A print rule that resets padding (`body.has-toolbar { padding-top: 0 }`) silently removed the top edge on REAL receipts while the preview looked right — measure the real document, not the preview.
- `e2e/food.kitchen-slip.spec.ts` (project `restaurant`) reads every document handed to the printer, in order. Restaurant dishes open an options sheet — a test that taps tiles in a row gets stuck for its whole timeout.
- Sale sheet: `data-testid="kitchen-slip-note"`; slip footer "KITCHEN COPY — NOT A RECEIPT".

Related: [[shopos-counter-order-kitchen]], [[shopos-takeaway-slip]], [[shopos-invoice-receipt]]
