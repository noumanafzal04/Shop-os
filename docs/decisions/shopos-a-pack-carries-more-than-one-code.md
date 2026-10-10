# A pack carries more than one code — and stays the same pack

**2026-10-10 · the packaging gap**

The third outside note in three months proposed "Product → Selling unit →
Barcode", and for the third time the model was already here (`product_units`:
a name, a factor, its own price, its own barcode; one base-unit pool of stock).
Reading for what was actually missing found one gap that had been named — and
four that had not.

## The gap that was named

**A pack had room for one barcode.** A carton has the maker's outer code, and
often a distributor's sticker or last year's number beside it.

That was more than a missing convenience. The second code had exactly one
other place to go — the item's "Additional barcodes", whose own hint read
*"e.g. a different supplier's pack of the same item"* — and every code there
means ONE PIECE. So a shop that followed the form's advice had a carton of 24
ring as a single: Rs 50 for Rs 1,080 of biscuits, with nothing on the screen
to say so.

`product_barcodes.product_unit_id` (migration `2026_10_10_000001`). A row is a
piece's (neither column), one size's (`variant_id`) or one pack's
(`product_unit_id`) — never two. The form has "+ Add a code" under each pack;
the till's lookup resolves the pack; a pack row in a spreadsheet takes them in
its Barcodes column.

**One code, one thing.** An extra pack code may not be the item's own barcode,
one of its other codes, a size's SKU or code, or anything on another pack —
this item's or anyone's (`BarcodeNamespace::assertFreeForPack`). And a piece's
code may not be one that is already on a pack. The first barcode of a pack
keeps its older, looser rule (it may repeat its own item's): the lookup
reaches the piece first so nothing rings wrong, and refusing it now would stop
a shop saving an item it has had for a year.

## The four that were not

**Every save of an item gave its packs new ids.** `SyncProductUnitsAction`
deleted the packs and wrote the list again, whatever had changed. A pack's id
is what a sale carries, so a till with a carton already on its bill, a tablet
working offline, or a quotation waiting to become an invoice was refused —
"A pack unit in this sale is no longer available" — because somebody had
corrected the item's description. A pack is now matched to the one already
there (by id when the caller sends one, by name when it does not: the import,
an older panel) and updated where it stands.

**Saying nothing is not saying none.** `barcodes` on a pack is the whole list
when present and "as it was" when absent. That distinction is what lets a
price-list import — which knows nothing of codes — pass through without
stripping every carton of its second one. The panel follows the same rule: a
pack row built from an answer that did not include the codes does not send an
empty list back (`catalog/packCodes.ts`).

**Offline, a code could not say what it meant.** The till's catalogue carried
every extra code in one plain list. So with no connection the code on the
one-litre bottle found the drink and asked which size, while holding the
answer. `PosProjection` now sends `codes` — `{code, variant_id, unit_id}` — and
the index reads the narrow meaning before the broad one. A pack's codes are
deliberately NOT in the plain list: a till built before this reads every entry
there as a piece, and would ring a carton for the price of one, offline, with
nobody to say otherwise. Left out, it answers "no item found" — a refusal a
cashier can see.

**A deleted item kept its codes for ever.** The item's own barcode was freed
by the soft delete; its other codes and its packs were rows of their own and
were left standing. Carding the item again was refused — "already used by
another product" — by a product that could no longer be found anywhere to take
the code off. Deleting an item now deletes its codes and its packs.

## And one that was found on the way out

Five spec files run one after another spent the owner's 240 requests a
minute, and the till in the sixth drew **"No products match."** over a shelf
of forty items: its product list had been answered 429.

A refusal for lack of permission has had its own words since a cashier spent
an evening believing the shop had no products. A request that FAILED did not —
and since a failed client request is never retried, the till stayed that way
until somebody typed in the box. `loadFailure()` beside `deniedReason()`, and
`<CouldNotLoad>` beside `<NoAccess>`: what failed, in the server's own words,
and a Try again. Both drawings of the shelf (tiles and rows) had their own
empty state to get this wrong in; `till-list-failed.spec` checks both.

## Held by

- `APackCarriesMoreThanOneCodeTest` (25), `packCodes.test`, `barcodeIndex.test`,
  `CouldNotLoad.test`; `e2e/pack-codes.spec`, `e2e/till-list-failed.spec`.
- Mutations: 54 run, 54 caught (four survived first — a swap of codes between
  two packs, a pack that left the list, an anchor that matched three places,
  and Try again in the view the test had not pressed it in).

## Deploy

**One migration** — `php artisan migrate`. It adds a nullable column; no data
changes. Backend first, then the panel: an older panel against the new server
keeps working (it sends no pack ids, and packs are matched by name).
