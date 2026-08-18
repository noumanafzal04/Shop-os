---
name: shopos-invoice-receipt
description: Invoice/receipt must be print-perfect AND live-previewable inside Shop Settings while the invoice options are being edited
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-05T14:35:32.374Z
---

The user considers the invoice/receipt output "not good enough" and wants it made
perfect: proper tax-invoice layout, split-tender breakdown, cashier + lane, serials,
REPRINT/GIFT marking, NTN/STRN/FBR POS identifiers, and correct thermal (58/80mm)
vs A4 rendering.

Separately and explicitly: **Shop Settings must show a LIVE invoice preview beside
the invoice/receipt settings**, so the shopkeeper sees the effect of header, footer,
logo, width, cashier line and tax-ID changes as they type — not after saving and
ringing a sale.

**Why:** the invoice is the only artefact that leaves the building; it is the shop's
face to the customer and its evidence in a dispute. Settings that can only be judged
by printing a real sale get configured wrong and stay wrong.

**How to apply:** treat the receipt template as a first-class deliverable, not a
byproduct of the sale flow. When adding any invoice/receipt setting, wire it into
the settings preview in the same change. Related: [[shopos-hardware]] (per-lane
printer + receipt width), [[shopos-ui-conventions]].
