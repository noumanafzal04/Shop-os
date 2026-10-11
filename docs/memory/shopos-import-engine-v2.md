---
name: shopos-import-engine-v2
description: BUILT + PUSHED 2026-10-09 (backend 1ea6c06, panel 6e6290c) — one import engine: xlsx+csv, columns by trade AND modules, preview by rollback, categories never invented, column mapping for other systems, failed-rows file; 2,000 rows/file
metadata:
  type: project
---

**2026-10-08, user:** "abhi business type k lehaz sy tenants ko import k issues
arhy hain" — shared a ChatGPT outline, asked to keep it and handle it with the
best solution **at the end** (after the journey order Services → Online →
Finance). Don't start it before then unless the user says.

**User's own words, 2nd message:** each tenant needs import fields by its
BUSINESS TYPE **and by its ASSIGNED MODULES** ("assgined modules k
accordinglly") — e.g. no batch/expiry columns unless the shop has that module,
no variant/serial/wholesale columns for a shop that doesn't use them. Template
columns AND validation must follow the tenant's enabled modules/features, not
the trade alone (see [[shopos-modules-on-off]], `BusinessTypes::itemTypesFor()`).

**2026-10-09 — BUILT.** Decision `docs/decisions/shopos-any-shops-file.md`. Backend `ImportProductsAction` (rewritten), `App\Support\Spreadsheet\*` (own zip/xlsx — NO composer package, zlib only, because the user deploys by git pull + composer install and a missing ext would break it), `App\Support\Import\{Cell,CategoryPaths,ProductSheet}`, `ProductCsv::columnsFor/whyNot/fieldFor`. Panel `ImportProductsModal` (file → check → import) + `importFile.ts` + Export menu. Tests: `AnyShopImportsItsCatalogTest` 44, `SpreadsheetTest` 18, 42 backend mutations caught, e2e `import-catalog.spec.ts` + 9 browser mutations. **11 real failures reproduced first** (salon rows refused; dishes/medicines became physical products; a price list cleared `requires_prescription`; "2,850" refused; `8.96E+12` SAVED as a barcode; semicolons, line breaks, Windows-1252; legacy trade code lost its columns). Answers given to the user: category by NAME/path never id; stock comes with the import (recount on update); 2,000 rows/file measured (12 s on MySQL here); another system's file → aliases + mapping step. NOT built: chunked import >2,000 rows; the writer was never opened in real Excel (openpyxl only). Trap: the CHECK must not carry category answers — the browser found the question vanishing.

**2026-10-09: user CHOSE this as the next work** ("Product import (Recommended)") and added: "Import export ko achy sy bnao kisi b business type waly ko issue na aye." IN PROGRESS.

**The outline (user's requirements):**
- ONE common import engine → per-business-type template → per-trade validation.
  Never a separate import system per trade.
- Trade fields: pharmacy batch/expiry/generic/dosage; garments size/colour/
  variant; electronics model/serial-IMEI/warranty; wholesale pack/carton/pricing.
- **.xlsx template**: Category column is an Excel DROPDOWN fed from a hidden
  `Categories` sheet of full PATHS ("Grocery > Beverages"). User picks the path,
  never an id. CSV = path text.
- On import resolve path → category_id **within the current tenant**; never
  trust an id from the file.
- **Unknown category: do NOT create silently** (typos breed duplicates) — let
  the user pick existing / create / skip the row.
- Flow: download template → upload → column mapping → category resolution →
  trade validation → PREVIEW ("973 valid, 27 errors", row-level reasons) →
  import → summary. Downloadable error file with `_error_message`,
  `_import_status`.
- Existing products exportable for bulk-edit-and-re-import.

**Where today's code differs (verify before building — this was true 2026-10-08):**
- Template is already generated per trade (`ProductCsv::headersFor()`,
  `TRADE_ONLY`) — see [[shopos-import-per-trade]]. CSV only; no xlsx library
  in composer.json.
- Category is matched by NAME and **created if missing** — the outline says
  the opposite; that is a decision to put to the user (or make missing = row
  error with a "create these N categories" choice in preview).
- Variants import as rows with `parent_sku` and MERGE, never replace — keep that.
- First step at the end: reproduce the user's actual per-trade failures on a QA
  tenant before designing, since "issues" were not specified.

Related: [[shopos-import-per-trade]], [[shopos-packaging-units]], [[shopos-resume-here]]
