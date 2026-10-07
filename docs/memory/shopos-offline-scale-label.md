---
name: shopos-offline-scale-label
description: FIXED — scale label rang nothing offline; one fixture file for both parsers; price label = whole rupees (scale_price_decimals 0|2)
metadata:
  type: project
---

Offline scan looked a 13-digit scale label up in the barcode index → "Nothing here matches". `scale_barcode_*` were already in the till's SETTINGS store (shipped by `PosCatalogController::TILL_SETTINGS`) and read by nobody; `CodeMatch.quantity` was declared for this and always null.

**How to apply:**
- `panel/src/modules/offline/lookup/scaleLabel.ts` = `ScaleBarcode::parse` + `PosController::scaleLookup`. Change the server rule → regenerate `backend/tests/fixtures/scale-labels.json` (`SHOPOS_WRITE_FIXTURES=1 php artisan test --filter=ScaleLabelFixturesTest`) and copy to `panel/src/modules/offline/lookup/fixtures/`.
- `findByCode` asks the label reader FIRST (as the server does); an unplaced label is a miss, not retried as a barcode.
- **DECIDED 2026-10-07 (user: "decimal chahiye hi nahi hota invoices mein"):** a PRICE label is whole rupees by default — setting `scale_price_decimals` 0|2, fixtures VERSION 2, Settings → Barcodes → "Price on the label" (shown only in price mode).

Related: [[shopos-offline-browse]], [[shopos-mirror-and-refusal]]
