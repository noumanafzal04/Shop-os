# An item form keeps what you changed; opening stock is in the history

Date: 2026-10-15. The user's review item: "Product page or add product ko go through kr lena — tabs, active
/inactive, inventory track ho rhi jb product create krty, us product ki inventory and barcode b." Bugs L10, L11,
L12. Walked on the load-test grocery shop (`qa-kit/p6-add-item.mjs`, `p6-item-active.mjs`).

## What was checked and held

Add item (Details, Online, Sizes & options, Codes & packs): name, price 120, cost 90, opening stock 24, low-stock
alert 5, barcode 8964000111222 → saved as tracked, 24 on hand, alert 5, the barcode, the cost; the till's scan
finds it; the list row says Rs 120 · 24 · Active · In-store only. Retired (Still selling this OFF) → list
"Inactive", the till's scan "No item found for that code."; brought back → Active, scanned again.

## L10 — the edit form undid what you changed (P1)

The edit form copied the item into its boxes every time the item query handed back a new object, and the till's
catalogue sync (the heavy one, L3) refetches it a few seconds after the form opens. Switch "Still selling this"
off, press Save, and the item was saved ON: the refetch had put the old value back. Any field changed in those
seconds went the same way. Now `useFillOnce` fills the form once per item (again only for a different item). And
until the item has arrived the form is covered ("Opening the item…") and Save is shut — the boxes held a new
item's defaults until then (Still selling this ON for a retired item), and a press in that gap was undone the
moment the item arrived.

## L11 — opening stock was not in the stock history (P2)

An item carded with 24 on hand showed 24 and "No movements yet" under Inventory → its movements. `OpeningShelf`
(the one writer of opening stock: a new item, each new size, a size added later, an import) now writes one `in`
movement, "Opening stock", referenced `opening` — nothing that reads purchases, sales, transfers or batches
filters on that, so no report changes. Items made before today have no such line.

## L12 — "needs a description" without a way out (P3)

In a shop with an online store a new item is sold online by default, and is refused without a description —
said at the top of the form while the box is at the foot of Details and the switch on another tab. The refusal
now has its two ways out as buttons: Write a description (jumps to the box) and Sell it in the shop only (turns
the online switch off). The box's own hint names the switch.

## Proof

`AnItemsOpeningStockIsInItsHistoryTest` (3 tests; 3 mutations caught; 727 inventory/catalogue tests pass);
`useFillOnce.test.ts` (2; mutation caught). Walks as above.
