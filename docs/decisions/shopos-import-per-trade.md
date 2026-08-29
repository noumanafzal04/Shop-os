# A template a shop can actually use

**2026-08-29.** The shop reported an error importing products. Reproduced against
the live panel — a restaurant downloaded its own official template and uploaded
it back **unchanged**:

```
Imported 4 new, 2 failed.
  row 3 -> Item type "medicine" isn't available for this business type.
  row 7 -> Item type "service" isn't available for this business type.
```

Both halves are bugs. We handed out a file we then refused; and the four rows
that **did** succeed put Loose Sugar and a Galaxy A16 into a restaurant's
catalogue, named exactly like real stock.

## The cause is two lists

The template carried six hard-coded rows handed to every trade whatever it sold.
The importer refuses an item type the trade may not catalogue, read from
`BusinessTypes::itemTypesFor()`. Two lists, and they drifted.

## Generated, not eight files

Eight hand-written templates would drift exactly as this one did. The template is
built from the shop that asks for it, and its rows come off **the same list the
validator reads** — so it cannot offer a row the importer will refuse, and a
trade added next year gets a correct template without anybody writing one.

Columns narrow too. The **export stays full**: it is a backup, and one that
dropped a shop's prescription flags would lose them on the round trip.

## Sizes, in the same file

A product with variants could not be bulk-loaded at all. A size is now a **row**
naming its parent by `parent_sku` — not a cell like `Small=900|Large=1000`,
because a size has a price, a cost, a stock figure, a barcode and a SKU, and
packing five fields into one cell means editing a string in Excel.

**By SKU, never by id.** The file carries no ids anywhere — category by name, tax
group by name, parent by SKU. A shopkeeper knows their own SKU; they cannot know
a uuid that does not exist until the row above them is imported.

Two things it must get right, both tested:

- **Order must not matter.** Sorting by name puts "Large" above "T-Shirt". Two
  passes.
- **A partial file must not retire a size.** `SyncProductVariantsAction` retires
  whatever is missing from the list it is given — right for the edit screen,
  catastrophic here. It merges instead; removing a size stays deliberate.

## Two I caused, both caught

`categoriesFor()` returns value/label pairs describing **sub-trades**, not shelf
names. And adding a `Parent SKU` header **shifted every export cell after SKU**,
because those rows are built positionally — an export with barcodes under the
wrong heading, re-importing into the wrong field.

The old "template header == export header" invariant was deliberately broken, so
its test now asserts the weaker true thing plus a denominator that the narrowing
is real.

2365 backend tests. Panel: 1319 tests, 0 lint errors.
