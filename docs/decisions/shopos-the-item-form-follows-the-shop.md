# The item form follows the shop: photo beside the name, and a refusal you can see

**2026-10-09 · asked for by the owner**

> "Product page ko achy sy dekhna b hai, uska UI… images tb show ho rhi jb
> online assign ho or baki tabs b… thora acha neat and clean UI kr dena."

## What was wrong

- **The second tab was "Media & online" in every shop that kept photos**,
  online store or not. A tyre shop with no online shop was shown a tab
  promising one, with a single picture on it and the rest of the tab empty.
- **A service could not be retired.** "Still selling this" sat at the foot of
  Codes & packs, and a service has no such tab — so a salon could only DELETE
  a service, which takes its sales history's link with it. The comment above
  the switch said it had been put "outside the goods-only block" for exactly
  this reason; the block was, the tab was not.
- **A save refused on another tab said nothing.** The form draws each of the
  server's messages beside its field, and a field on a tab nobody is looking at
  is not on the screen. A barcode another item already has, typed on Codes &
  packs, left somebody on Details pressing a Create button that did nothing.
  A dozen fields had no message of their own on ANY tab.
- Codes & packs was a three-column grid whose third column carried the unit
  chips: everything below it sat at a different height in each trade, with
  "Sold by" alone on a row.
- The tax-group box read "Select an option" while holding a real answer.

## Now

- **Details** — the photo beside the name (where the shop keeps photos: the
  Images module, or an online store), then one card each for Price and Stock,
  the trade's own sections, the description, and **Still selling this** — on
  the tab every item has.
- **Online** — only in a shop with the online store, and only what is about
  selling online: whether this item does, what a customer will find (a photo
  and a description, each with a link to where it is added), collections, and
  the least they may order (moved here from the foot of the bulk-pricing card).
- **Sizes & options** and **Codes & packs** keep their names. Codes & packs is
  two to a row: SKU | Barcode, Brand | Wholesale price, Base unit | Sold by.
  Every list on it is the same card, with its one action level with its title.
- **A refusal out of sight is said at the top** of whichever tab is open,
  names the tab it is on, takes you there, and marks that tab with a red dot.
  A field on the open tab that already says it itself is not said twice.
- On an existing item the header carries its type, and "Not selling" when it
  has been retired.

`catalog/formTabs.ts` holds the two rules — which tabs there are, and which
tab a field is on — so the form, the dot and the message cannot disagree.

## What shows for whom (the owner asked, while this was being built)

| On the form | Shown when the shop has |
|---|---|
| Item type "Service" | the Services module |
| Item type Food / Medicine | the trade (restaurant / chemist) and the Products module |
| The photo | Images, or the online store |
| The Online tab | the online store |
| Stock card | Inventory, and an item type that can be counted |
| Barcode, extra barcodes, packs, wholesale, scale code | POS |
| Sizes & options | **everybody** — it follows the item type, not a module (every type but a deal) |

Sizes are not a module anybody can be sold or refused. If they should be, that
is a decision for the owner, not something this change makes.

## Held by

- `formTabs.test.ts` (10) — the two rules.
- `onePhoto.test.ts` — re-anchored on the photo's new place.
- `e2e/item-form.spec.ts` — the tabs, the photo on Details, a barcode refused on
  another tab and said on this one, the Online tab's checklist, and a service
  retired from its own form. **Twelve one-line mutations, twelve caught.**

## Not done

- A deal's Codes & packs tab holds only its SKU. Moving one field to another
  tab for one item type would make the form fork by type; left.
- The seeder draws no product photos, so the photo tile is empty in a demo.
