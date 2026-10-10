# The trail and the file

**2026-10-10 · two more of the items left after the queue — both things the
console could not answer**

## Who changed what the platform charges

The add-on price list on a development database went from one price to none
in half an hour, and "who emptied it, and when?" could not be read off
anything. A shop's every module switch was in the audit log. The list that
decides what every shop is BILLED for a module was not — nor the commission
rate, nor whether commission is charged at all, nor the console's look.

`PlatformSetting` is `Auditable` now. A setting's row is keyed by its name,
so that name is the row's id in the trail (`entity_id`), and the trail's own
filter offers *Platform Setting* without being told to.

Three things it had to get right to be worth reading:

- **The value as itself.** The column is JSON whatever it holds, and a value
  just written arrives raw: a switch as the letters `true`, a rate as "3.5",
  a word inside its own quotation marks. The model decodes it, so a row reads
  `off → on` and not `false → 'true'`.
- **Who, once.** `updated_by` is left out of the values — the trail's own
  column already says who.
- **A reset is a row.** `PlatformSettings::forget()` deleted with a query,
  which files nothing; it deletes through the model.

On the screen a setting's row is worded by the screen that sets it
(`settingLines` in `admin/auditChanges.ts`), and the price list is opened up
the way a shop's module map is:

    Add-on price · Bank Card Offers:   free → Rs 350
    Add-on price · Products:           Rs 25,000 → free

The second is the line that could not be found.

## The ledger as a file

The billing screen's button read "Export this page" and meant it: twenty
rows, built in the browser from what was on screen. A month has more than
twenty payments, and "what did we take in September" handed to an accountant
as page one of three is a wrong answer that looks complete.

`GET /admin/billing/payments/export` writes the whole filtered ledger. The
filter is ONE query now (`BillingController::ledger()`): the list, its
totals, what it was paid with and the file are all it, so the file adds up to
the figure above the table and the test holds the two endpoints to each other
for six filters.

Two things the file turned up that were true of every export in the product:

- **Formulas.** A cell beginning `=`, `+`, `-` or `@` is run by a
  spreadsheet. A business's name is chosen by the shop, and this file is
  opened by the platform's accountant. `CsvExport::text()` puts an apostrophe
  in front of such a cell — and leaves a number alone, because "-500" is a
  refund and has to stay a figure in the column it is summed in. It is in the
  shared helper, so every export has it.
- **The file's name.** The panel is another origin, and a browser hides every
  response header a server does not name. `Content-Disposition` was not
  exposed, so every export in the product was saved as `export.csv`,
  `export (1).csv`, `export (2).csv`. It is exposed.

No migration.
