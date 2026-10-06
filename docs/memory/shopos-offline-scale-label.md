---
name: shopos-offline-scale-label
description: FIXED 2026-10-06 — offline, a weighing scale's label rang nothing; scaleLabel.ts mirrors ScaleBarcode, held to scale-labels.json; OPEN: price labels read as hundredths
metadata:
  type: project
---

Offline scan looked a 13-digit scale label up in the barcode index → "Nothing here matches". `scale_barcode_*` were already in the till's SETTINGS store (shipped by `PosCatalogController::TILL_SETTINGS`) and read by nobody; `CodeMatch.quantity` was declared for this and always null.

**How to apply:**
- `panel/src/modules/offline/lookup/scaleLabel.ts` = `ScaleBarcode::parse` + `PosController::scaleLookup`. Change the server rule → regenerate `backend/tests/fixtures/scale-labels.json` (`SHOPOS_WRITE_FIXTURES=1 php artisan test --filter=ScaleLabelFixturesTest`) and copy to `panel/src/modules/offline/lookup/fixtures/`.
- `findByCode` asks the label reader FIRST (as the server does); an unplaced label is a miss, not retried as a barcode.
- **OPEN for the user:** price-mode value is hundredths (02700 = Rs 27.00) → max Rs 999.99 per label; Pakistani scales usually print whole rupees. Recommend a "decimals on the label" setting (0 or 2).

Related: [[shopos-offline-browse]], [[shopos-mirror-and-refusal]]
