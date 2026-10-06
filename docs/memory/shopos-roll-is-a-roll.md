---
name: shopos-roll-is-a-roll
description: FIXED 2026-10-06 — `@page { size: 80mm auto }` is INVALID CSS (browsers print A4); PrintPaper (server) + fitRoll (panel); a test had asserted the bug string
metadata:
  type: feedback
---

User report: "thermal 80mm select hai, POS print A4 nikalta hai."

**Why:** `size` takes one length, two lengths, or a named sheet. `80mm auto` is dropped by Chrome AND WebKit (measured: 216 mm vs 80 mm with `80mm 200mm`). Four Blade templates + the hardware Test print had it. `ReceiptTest` asserted `assertSee('size: 58mm auto')` — green for as long as the bug existed.

**How to apply:**
- Server: `App\Support\PrintPaper::pageSize()/htmlAttributes()` is the only place a page size is written (roll width × 297 mm fallback + `data-roll-mm` on `<html>`). A view with its own `@page` fails `ARollIsARollTest`.
- Panel: every document prints through `printHtmlDocument` → `fitRoll()` sets `size: <roll>mm <measured>mm`. The iframe must have the roll's real width or the height is wrong.
- Never assert a CSS STRING to prove printing. `e2e/till-print.spec.ts` catches the document at `print()` and measures `page.pdf({ preferCSSPageSize: true })`.
- Cannot fix a printer driver set to a fixed sheet — Help says where to change it.
- `ReachableTest` (backend) now reads `resources/views`: a template is a caller.

Related: [[shopos-invoice-receipt]], [[shopos-hardware]], [[shopos-outcome-not-coverage]]
