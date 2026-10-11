---
name: shopos-product-and-labels-ui
description: BOTH DONE 2026-10-09 — labels (sheet beside the list, dropdown settings on the page, pack labels) and the item form (photo on Details, Online tab only with online store, refusals said across tabs, a service can be retired)
metadata:
  type: project
---

**2026-10-09, user's own words (Roman Urdu), asked mid-import. Do AFTER the
import/export work ([[shopos-import-engine-v2]]).**

1. **Product page (item form):** "achy sy dekhna hai uska UI… neat and clean".
   Images show only when Online is assigned, "or baki tabs b" — tabs and
   sections must follow the shop's ASSIGNED MODULES and read tidy; review every
   tab for what appears when.
2. **Products listing page:** add a button to generate labels / barcodes.
3. **Label / barcode generation page:** better UI/UX. **Move its settings OUT of
   Shop Settings and onto the labels page itself** "ta k pta chaly kya setting
   apply kr raha kya ni" — the person printing must see which settings are in
   force.
4. **Layout:** products on one side, the label sheet preview on the other, on
   ONE page. Show how many labels are going onto a sheet; when they pass one
   sheet, the preview paginates to the next.
5. "or ui improve kro" — general polish on these screens.

**2026-10-09 — items 2, 3, 4 DONE and pushed** (decision `shopos-the-sheet-beside-the-list`). Follow-ups the user gave mid-build and got: every option as a DROPDOWN ("On each label" is a tick-list dropdown); A4 preview as large as fits, real size via "Actual size" (list fixed at 340 px). Also fixed while there: number barcodes were Set B → 13 digits printed too thin on the default sticker; now Set C.

**Item 1 (product form) DONE 2026-10-09** — go-ahead was "Continue" on the row that
said it was waiting. Decision `shopos-the-item-form-follows-the-shop`. Photo on
Details beside the name; second tab is "Online" and only with the online store;
"Still selling this" moved to Details (a SERVICE could not be retired — its tab
did not exist); a save refused on another tab is said at the top with the tab
marked (it was silent); Codes & packs two to a row. Rules in
`catalog/formTabs.ts`. `e2e/item-form.spec.ts`, 12 mutations caught.
The user asked what shows for whom: Service type = Services module; Online tab =
online store; photo = Images or online; **sizes = everybody** (item type, not a
module) — left as is, their call if sizes should be sold as a module.

**Known facts to start from (verify):** `panel/src/modules/catalog/pages/LabelsPage.tsx`
prints one label per product (base barcode, largest pack as a text line — the
per-pack label gap in [[shopos-packaging-units]]); label/barcode prefs live in
`ShopSettingsPage` tabs "Barcodes" / "Receipt"; a roll is not a page
([[shopos-roll-is-a-roll]]); the user likes COLOURFUL but flat, no shadows
([[shopos-ui-direction-oct06]], [[shopos-mobile-design]]); check 1366×768.

Related: [[shopos-reorder-and-labels]], [[shopos-ui-conventions]]
