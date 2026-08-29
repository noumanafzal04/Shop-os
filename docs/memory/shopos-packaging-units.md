---
name: shopos-packaging-units
description: Multi-packaging (single/pack/box/carton) is ALREADY BUILT as ProductUnit; the one real gap is a label per pack, not the architecture
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
