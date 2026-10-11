---
name: shopos-packaging-units
description: Multi-packaging is ProductUnit (already built). 2026-10-10 the two gaps CLOSED + PUSHED: a pack carries several codes (product_barcodes.product_unit_id), a label per pack; packs now KEEP THEIR ID across an edit; ONE migration
metadata:
  type: project
---

A 2026-08-29 note proposed "don't make Product = Barcode; make Product → Sellable
Units → Barcodes + Prices" for biscuits/soap/Coke/surf. **CartZe already is that.**
Checked in the code, not assumed:

- `product_units` (migration `2026_07_21_000004`): `name` (Strip/Box/Carton),
  `factor` (base units per pack), `price` **nullable — explicit pack price, and
  null means base × factor**, its own `barcode`, `sort_order`.
- `ProductUnit::priceUsing()` implements exactly the note's rule: a box may be
  Rs 450 when 24 singles are Rs 480, and the system never assumes the multiple.
- Stock is ONE base-unit pool. Selling a pack draws `factor × qty`, so no
  duplicate stock to maintain — the note's "better inventory logic".
- `sale_items.unit_name` + `unit_factor` snapshot which pack was sold, for
  returns and reports.
- `ProductBarcode` holds extra codes (supplier packs, old/new labels, inner and
  outer cartons) and carries `variant_id` too.
- `BarcodeNamespace` already fences pack/single/variant codes against collision
  — the note's "barcode namespace issue" is covered.
- Offline: `barcodeIndex.ts` indexes every pack barcode (`unitId` set when the
  code is a pack), and a base-unit code outranks a pack that repeats it.
- Purchasing, import, POS, restaurant tickets and sale documents all accept a
  unit.

**The one genuine gap:** `LabelsPage` prints ONE label per product — base
barcode, base price — and mentions the largest pack only as a text line
("Box = 100 pcs"). The note wants a **separate label per sellable unit**: a
single at Rs 20 with `896…001`, a box at Rs 480 with `896…002`. That is a
label-generation change, not an architecture change. Small, and worth doing.

**Why this matters beyond the feature:** this is the second time a long external
analysis recommended an architecture CartZe already had. Read the schema before
scoping any of it — see [[shopos-pos-trade-coverage]].

Related: [[shopos-code-for-each-size]], [[shopos-pharmacy-edges]],
[[shopos-reorder-to-po]].

**2026-10-09 — a THIRD note with the same architecture (user pasted a ChatGPT
outline: Product → Selling unit → Barcode; stock in base units; receive in
cartons; asked to keep it in memory).** Checked against the code again:

| The note asks for | In the code today |
|---|---|
| Piece / Pack / Carton as units with a multiplier | ✅ `product_units` (`factor`, own `price`, own `barcode`) |
| Stock kept in the base unit; selling a carton draws 24 | ✅ one base pool, `sale_items.unit_factor` |
| Receive in cartons, stock in pieces | ✅ `purchase_order_items.product_unit_id / unit_name / unit_factor` (mixed = one line per unit) |
| An opened carton needs no transaction | ✅ nothing tracks pack state |
| Different sizes of Lays are separate products | ✅ shop's choice; variants also exist |
| **Several barcodes for ONE selling unit** | ❌ GAP: `product_units.barcode` is ONE code per pack; `product_barcodes` (extra codes) has `product_id` + `variant_id` and **no `product_unit_id`**, so an extra code always resolves to the base unit |
| A label for each pack | ❌ still the gap noted above (`LabelsPage` prints one label per product, largest pack as a text line) |

So what is left to BUILD is two things, not a new model: extra barcodes that
point at a pack, and a label per sellable unit. Do with [[shopos-import-engine-v2]]
(import must carry pack barcodes too). Not started — user said keep it for later.

**2026-10-10 — BOTH GAPS CLOSED, PUSHED** (backend `307244a`, panel `ed36513`,
docs `96ed217`; decision `docs/decisions/shopos-a-pack-carries-more-than-one-code.md`).
**ONE MIGRATION `2026_10_10_000001`** (nullable `product_barcodes.product_unit_id`;
applied to dev). A label per pack was already built on 2026-10-09 (labels page).

- The gap was a MONEY bug, not a nicety: a carton's second code could only go
  under "Additional barcodes" (the form's own hint said "a different
  supplier's pack"), and every code there rings ONE PIECE.
- A barcode row is a piece's / one size's (`variant_id`) / one pack's
  (`product_unit_id`). `BarcodeNamespace::assertFreeForPack`.
- **`SyncProductUnitsAction` used to delete + recreate every pack on every
  save** → new ids → a till / offline tablet / quotation holding the old id got
  UNIT_UNAVAILABLE after an unrelated edit. Now matched by id, then name, and
  updated in place. `units[].barcodes` ABSENT = "as it was".
- `PosProjection.codes` ({code, variant_id, unit_id}); pack codes are kept OUT
  of the plain `barcodes` list an older till reads as pieces.
- Deleting an item now frees its other codes and its packs' codes.
- Tests: `APackCarriesMoreThanOneCodeTest` (25), `e2e/pack-codes.spec`;
  mutations 54/54.
