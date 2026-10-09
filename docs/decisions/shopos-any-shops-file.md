# Any shop's file comes in: one import engine, the shop's own columns

**2026-10-09 · asked for by the owner — "tenants are having import problems by
business type; fields must follow the business type AND the assigned modules"**

## What a shopkeeper's file actually is

Every import test until now typed `item_type` as a code on every row and
uploaded a clean UTF-8, comma-separated file. Nobody who runs a shop does
either. Eleven tests written the way a file really arrives all failed:

| The file | What happened |
|---|---|
| A salon leaves the type column out | every row refused |
| A restaurant / a chemist leaves it out | dishes and medicines became "physical product" — stock-counted, no modifiers, no lots |
| The type as the screen writes it ("Medicine") | refused: only the code was known |
| **A supplier's price list — name, SKU, price** | **the prescription rule came off every controlled drug, discontinued items went back on sale, hidden ones were published** — a missing column was read as "no" |
| A price written "2,850" | not a number |
| A barcode Excel had turned into `8.96123E+12` | **saved as the barcode** |
| A file separated by semicolons | refused whole: "no name column" |
| A description with a line break | two rows, both wrong |
| "CSV (Comma delimited)" from Windows Excel | names saved with `�` in them |
| A shop under an old trade code (`clinic`) | a template with no medicine column |
| An .xlsx — what Save does | not accepted at all |

And three that are not about the file: a category was taken from the FIRST
shelf of that name whoever its parent, and a name not found was **created** (a
typo became a category); an unknown tax group fell back to the default rate
in silence; a medicine could arrive with stock and no expiry, which the item
form has never allowed.

## One engine

`ImportProductsAction`, for every trade. What differs between shops is asked
of the shop, never written out per trade:

- **Columns** — `ProductCsv::columnsFor($tenant)`: the trade (resolved through
  `BusinessTypes::primary`, so old codes count) AND the modules. No stock
  columns without Inventory; no barcode, PLU, pack, wholesale or serial columns
  without the till; no "Visible In Marketplace" unless selling online; no Item
  Type for a shop that keeps one kind. `whyNot()` gives the reason, because a
  file that carries such a column anyway is not refused: the column is left out
  and the shop is told which and why.
- **Kind** — a row that does not say is the shop's own first kind (a dish, a
  medicine, a service). A deal cannot be a row: it is the items inside it.
- **A blank cell means "leave it"**; a column that is absent likewise.
- **Read as written** (`Import\Cell`): money with commas and "Rs", Yes/No,
  dates day-first and "03/2027" as the END of March, a damaged barcode said
  and never stored.
- **The file** (`Spreadsheet\Tabular`): CSV with its separator sniffed from the
  header, encoding detected, quoted line breaks kept — or .xlsx.
- **Nothing invented**: a category is found by its path, or by its name where
  that name is on one shelf only; on two it is asked about; on none it is NEVER
  made here — the person is shown it and chooses create / use one of mine /
  leave those rows out (`Import\CategoryPaths`). A mapped id is checked to be
  the shop's own. An unknown tax group refuses the row.
- **A row is a product, a size (Parent SKU) or a pack (Parent SKU + Pack
  Size)**. Sizes and packs merge; a file that mentions one never retires the
  others.
- **Another system's file**: common headings are known (`ProductCsv::ALIASES`);
  the rest are asked about on the check and sent back as `mapping`. A refusal
  names the column as THE FILE calls it.
- **Preview** — `dry_run` runs the same code in a transaction and rolls it
  back. There is no second validator to drift from the first.
- **Handed back** — `failed_rows` carries each refused row as it was sent, so
  the panel can give a "rows to correct" file with `_import_status` and
  `_error_message`; the import ignores those two columns on the way back in.

## Excel without a library

An .xlsx is a zip of XML. PhpSpreadsheet needs `ext-zip` and `ext-gd`, which
Laravel does not ask for, on a server deployed by `git pull && composer
install` whose extensions nobody has listed. So `Spreadsheet\Zip` (zlib only),
`XlsxReader` (XMLReader) and `XlsxWriter` are ours, and small. The template is
a workbook with a frozen header, code columns formatted as TEXT, drop-downs
fed from a hidden sheet of the shop's own categories, units, tax groups and
kinds — a category drop-down that WARNS (a new one may be meant), a Yes/No that
does not — and a sheet saying what each column is for. A server without zlib
is given the CSV instead.

Checked against a workbook made by a different library (openpyxl,
`tests/fixtures/import/excel-made.xlsx`), and the writer's output opened by
it. **Not opened in Microsoft Excel itself** — none on the build machine.

## Limits, measured

2,000 rows a file. On MySQL on the build machine: 2,000 rows ≈ 12 s to check
and 12 s to import; 5,000 ≈ 30 s each. A 1-vCPU server with web timeouts of
60 s leaves no room for more. A longer catalogue goes in as several files and
the refusal says so. Larger single files would need a chunked or queued
import — not built.

## Changed on purpose

- A category the shop does not have is no longer created. API callers that
  relied on that now get a refused row naming the category.
- An unknown tax group refuses the row (it was dropped in silence).
- The file needs a Name OR a SKU column (it needed Name and Price); a new item
  without a price is refused as a ROW.
- The stock-recount reason is "Import recount" (was "CSV import recount").

## Tests

Backend: `AnyShopImportsItsCatalogTest` (44), `SpreadsheetTest` (18), the older
import tests updated. 42 mutations, all caught; one "seen barcodes" list was an
equivalent mutant and was deleted. Panel: `importFile.test.ts`; `e2e/
import-catalog.spec.ts` walks another system's file through the screen, 9
browser mutations caught. The browser found one fault the server tests could
not: the check carried the category answers, so the question vanished from the
screen and the answer could not be changed.
