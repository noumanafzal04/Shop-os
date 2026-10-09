# Labels: the sheet beside the list, and its settings on the page

**2026-10-09 · asked for by the owner**

> "Label barcode generate ka UI/UX acha kro, uski setting shop setting sy
> remove krk usi page py lao ta k pta chaly kya setting apply kr raha kya ni…
> aik side py product aik side py barcode generate page… aik page py kitni add
> ho rhi or jb next page aye to pagination main chala jaye… A4 full size
> preview… sticker size, on each label, printed on — dropdown main."

## What was wrong

- The preview was "one of each product, up to six". Nobody could say how many
  stickers fit a sheet, how many sheets a run took, or where a sticker would
  land, until it had been printed. The print itself was one long run the
  browser broke into pages wherever it liked.
- The settings were in two places: two switches under Settings → Barcodes, six
  more behind a collapsed "Options" on the labels screen that were forgotten on
  every visit. Nobody printing could say which were in force.
- A product was ONE label. Its carton — scanned by the carton's barcode, sold
  at the carton's price — had none; it was a line of text on the single's.
- A number-only barcode was encoded one digit a symbol (Code 128 Set B). A
  manufacturer's thirteen digits came to 198 modules and, on the standard
  50 mm sticker, bars 0.237 mm wide — under what a till scanner reliably
  reads. The page warned "too long for this sticker" about every ordinary
  product, on the default size.

## Now

- **Left, what to print; right, the paper.** `catalog/labels/sheet.ts` holds
  the arithmetic both sides agree on: `perSheet` (30 of the standard sticker:
  3 across, 10 down), `sheets` (the run cut into sheets, used stickers blank on
  the first one only), `printables` (a product, and each pack and size that has
  a barcode of its own). The right-hand side is one A4 sheet as it will print,
  "30 fit on a sheet · 73 labels · 3 sheets", paged with arrows. The print is
  those same sheets — one `.paper-page` each.
- **As large as the screen has room for**, and at its real size on request.
  The list is a fixed 340 px so the rest is the sheet's: actual size from about
  1,500 px of window, 77% at 1,366, with an "Actual size" button.
- **Settings on the page, as drop-downs, saved for the shop.** Sticker size,
  printed on, on each label (a list of ticks), used stickers to skip. Six new
  shop settings (`label_stock`, `label_paper`, `label_show_digits`,
  `label_show_shop`, `label_show_pack`, `label_cut_lines`) beside the two that
  existed; `catalog/labels/prefs.ts` maps them. The line under them says
  "Saved for your shop" — or, for somebody who may print but not change
  Settings, "for this print only". Settings → Barcodes points here and keeps
  only the weighing-scale settings.
- **A pack is its own row and its own sticker**, with its barcode and its
  price (its pieces at the piece price where it has none).
- **Digits go two to a symbol** (Set C), an odd one out in Set B after the
  switch: 143 modules, 0.33 mm bars on the same sticker. Checked against
  another encoder's output (python-barcode) and read back by a decoder written
  without reference to either.
- **Products → Labels** carries along whatever the list was narrowed to.

## Not done

- The item form's own tidy-up (the owner will say when).
- Several barcodes for one pack; a real EAN-13 symbol (Code 128 is what every
  till scanner here reads).
- A label roll is still one sticker a page; multi-across rolls are not offered.

## Tests

`labels/sheet.test.ts` (15), `labels/prefs.test.ts` (5), `utils/code128.test.ts`
(+8), `ShopSettingsTest` (+2). `e2e/labels-sheet.spec.ts` — 13 browser
mutations caught. Journey stage G: G12 now changes the setting on the labels
screen and finds Settings pointing there; G9 uses a switch that is still on
the Barcodes tab.
