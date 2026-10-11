---
name: shopos-menu-in-shopkeepers-words
description: BUILT 2026-10-11 (NOT PUSHED) — shop sidebar regrouped in plain words (no Catalog, no More), Simple view = same menu filtered, gear = a person's own Simple menu kept as {add,drop} per user per device
metadata:
  type: project
---

**The user asked (2026-10-11):** "sidebar k label b achy krna — kisi ko catalog ka pta b ni hota — achy way menu sub menu banana ta k hr cheez asani sy mile, jo jis k related, or standard. Simple view = daily use menus according to permissions, ya wo khud add kr skty: setting icon on sidebar with toggle to add menu or sub menu in simple view."

**Built (panel only, no migration):**
- Menu lives in `panel/src/layout/shopNav.tsx` (`shopMenuInFull` + `shopNav`); `AppSidebar.tsx` only draws. Types in `navItem.ts`.
- Groups: Daily work · Manage (Products / Inventory / Purchases / Customers / Offers & discounts / Expense Manager / Reports / HRM) · Your shop (Staff ▾ Staff list + Activity log, Branches & warehouses, Subscription, Settings, Help Centre).
- "Catalog" → `itemsWord(features)` (Products / Services / Products & services), used by the menu AND the products page h1. "More" dissolved. Reservations → Daily work. Barcode labels → Products. Stock by place + Stock transfers → Inventory. Books-only business: Expense Manager is Daily work.
- `tidy()`: a group with one screen is a link (named for the group if the screen is `home`, else for the screen).
- Simple = full menu filtered to `usual` rows (all of Daily work + product list + stock + Expense Manager + Branches + Settings + Help), then the person's `{add, drop}`. Stored `shopos-simple-menu:<userId>` in localStorage (`simpleMenu.ts`, `simpleMenuStore.ts`, `SimpleMenuDialog.tsx`); Dashboard always shown; can never widen modules/permissions.

**My interpretation, not the user's words:** kept module names "Inventory", "Stocktake", "Disposals", "Expense Manager" (sold under those names, used in notifications); storing the choice per device rather than on the account; owner cannot set a cashier's menu. Tell the user these are open.

**Lessons:**
- A dialog mounted inside the rail is drawn UNDER the header (same z-index, header later in DOM) → `createPortal(document.body)`.
- New `shopos-*` storage key must be added to `common/brandName.test.ts` ADDRESSES.
- Setting `ui_mode` by `page.evaluate` after load races the provider's write-back → use `addInitScript` (fixed in at-volume.spec).
- On a phone the drawer animates away for 300ms; a test must wait for it before judging what is on top.

Related: [[shopos-rail-you-can-read]], [[shopos-work-screen-rail]], [[shopos-dashboard-rail-theme-oct06]], [[shopos-warehouse-and-wholesale]]
