# A menu in a shopkeeper's words

**2026-10-11 · at the user's word · NOT PUSHED until they say**

*"sidebar k label b achy krna — kisi ko catalog ka pta b ni hota — to achy way
menu sub menu banana ta k hr cheez asani sy mile, jo jis k related, or
standard. Simple view hoga usmain daily base py use hony waly menus according
to permissions — ya wo khud add kr skty: simple menu setting icon on sidebar,
with toggle to add menu or sub menu in simple view."*

Two requests in one message: name and file things so they can be found, and
let each person decide what their short menu holds.

## 1. What was wrong with the folders

They had been named by whoever built them.

| Was | Held | Problem |
|---|---|---|
| **Catalog** | products, categories, collections | nobody running a shop looks for a catalog |
| **Inventory** | stock, disposals, stocktake, **barcode labels, suppliers, purchases** | six rows, three different jobs |
| **Customers** | the customer book, **coupons, promotions, bank offers**, reviews, reservations | the offers were three rows deep in an address book |
| **More** | **Reports, Staff**, activity, vehicles, warranty, portfolio | the two screens an owner opens most, under a name that says nothing |
| **Branches & warehouses** | the places, stock by place, transfers | configuration and daily stock work in one folder |

## 2. How it is laid out now

Three parts, as before. Each group is one job, under the word a shopkeeper —
or any other till system — would use, and under the name the MODULE is sold
as wherever there is one, so the plan and the menu say the same word.

**Daily work** — Dashboard · POS · Dine-in · Kitchen / job board / Dispensary ·
Sales · Day & banking · Quotes & Advances · Orders · Reservations · Riders ·
Forecourt

**Manage**

| Group | Screens |
|---|---|
| **Products** (or Services / Products & services — what the business sells) | All products · Categories · Collections · Barcode labels · Portfolio |
| **Inventory** | Stock levels · Stock by place · Stock transfers · Stocktake · Disposals |
| **Purchases** | Purchase orders · Suppliers |
| **Customers** | Customer list · Vehicles · Warranty desk · Reviews |
| **Offers & discounts** | Coupons · Promotions · Bank card offers |
| **Expense Manager** | Cashbook · Ledger · Income · Expenses |
| **Reports** | one press |
| HRM | as it was (not in this version) |

**Your shop** — Staff (Staff list · Activity log) · Branches & warehouses ·
Subscription · Settings · Help Centre

Decisions inside that:

- **Reservations is daily work.** Somebody asked and is waiting to hear; it
  was the last row of the Customers folder.
- **Barcode labels is under Products** — a label is printed from the product's
  record, not from the shelf.
- **What each place holds is stock work; the list of places is the shop's.**
  Stock by place and Stock transfers moved under Inventory; Branches &
  warehouses is one link under Your shop.
- **A books-only business has its books as its day.** For an office with no
  till, Expense Manager is under Daily work — under Manage its day had one
  row in it.
- **A group holding one screen is that screen** (`tidy()`): "Customers ▾
  Customer list" was two presses to reach the only place it went. Named for
  the group when the screen left is its home (`home: true`), for the screen
  itself when it is not.
- **Left alone on purpose:** "Inventory", "Stocktake", "Disposals", "Expense
  Manager". They are the names the modules are sold under and appear on
  plans, notifications and the admin's lists; "Disposals" is the least plain
  of them and is the one to rename next if a shop trips on it.

The word "catalog" is gone from everything a shop reads: the products screen's
heading follows `itemsWord()` (Products / Services / Products & services), the
Help group is "Products & stock", and search boxes say "Search products…".

## 3. Simple view is the same menu with rows left out

It was a second menu, written by hand beside the full one — which is how a
restaurant's calm view once had the floor and no kitchen. `shopNav()` now
builds ONE menu (`shopMenuInFull`) and Simple keeps the rows marked `usual`:

- everything under **Daily work** — the heading means what it says;
- the product list, the stock (and what moves between places), the Expense
  Manager;
- Branches & warehouses, Settings, Help Centre.

By permission, because the menu was narrowed to what the person may open
before any of this runs. A cashier's Simple view is the counter.

## 4. The gear — a person's own Simple menu

Beside the Simple / Full view switch (and above it on a rail of icons). It
lists every screen the person can open, under the menu's own names and
headings, each with a switch. A group's switch is everything in it. It takes
effect as pressed; "Back to the usual menu" undoes all of it. The Dashboard is
always shown.

**Kept as differences, not as a menu** (`simpleMenu.ts`):

```
{ add: [screens switched on that are not usual], drop: [usual screens switched off] }
```

A saved copy of the whole menu would freeze it on the day it was saved: the
shop buys Delivery a month later and the owner who once moved one row never
sees Riders. Differences leave the rest free to move. A choice that agrees
with the usual menu is stored as nothing at all.

**Kept on the device, under the person's id** (`shopos-simple-menu:<user id>`,
`simpleMenuStore.ts`) — beside the switch it belongs to, which is also per
device. A till is shared and a menu is not, so two cashiers on one tablet each
have their own. The store is one small file; moving the choice to the account
later changes only that.

**It cannot widen anything.** The stored paths are intersected with the menu
the server's modules and the person's permissions already produced. A path for
a screen the shop no longer has, or the person may not open, is ignored.

## Files

- `panel/src/layout/shopNav.tsx` — the menu (moved out of `AppSidebar.tsx`,
  which now only draws)
- `panel/src/layout/navItem.ts`, `simpleMenu.ts`, `simpleMenuStore.ts`,
  `SimpleMenuDialog.tsx`
- `panel/src/modules/catalog/itemsWord.ts`
- five icons: tag, truck, bar-chart, bookmark, gear
- `Switch` takes `checked` (it could only remember its own last press)

## Tests

- `shopNav.test.ts` (words, groups, one-row groups), `navSections.test.ts`,
  `simpleMenu.test.ts`, `simpleMenuStore.test.ts`, `itemsWord.test.ts`
- `e2e/simple-menu.spec.ts` — desktop, phone, both tablets: the usual menu,
  the gear, a sub-menu alone, the group again, the reload, a group off, Full
  view, back to the usual

## Found on the way

- The dialog, mounted where it was opened (the rail), was drawn UNDER the
  header — its title and first rows were printed over by the search bar. It is
  handed to the document, the way a toast is.
- `at-volume.spec` set the menu view from outside after the app had loaded; the
  write could land between the provider's read and its write-back, and the
  reload then opened in Simple. It sets it before the page's scripts now.

## Not done

- The choice does not follow a person to a second device.
- An owner cannot set a cashier's Simple menu for them.
