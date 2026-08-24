# A code for each size

**2026-08-24 · backend + panel**

## A reader with no writer

The till has resolved a scan to one size through `product_barcodes.variant_id`
since the column existed:

```php
?? ProductBarcode::query()->where('barcode', $code)->whereNotNull('variant_id')->first()?->variant;
```

**Nothing ever wrote that column.** `SyncProductBarcodesAction` created every row
with `['tenant_id', 'barcode']`, so every alternate belonged to the parent
product. A drinks shop could not put the 500ml's EAN on the 500ml and the 1L's on
the 1L — which is the entire reason those two codes are printed differently. Same
for a chemist's strip and box, and a garment's size tickets.

The reader-with-no-writer shape, which is this repository's most repeated defect.

## Three more things were wrong once it was written

**The parent match swallowed the code.** The lookup finds a product by
`orWhereHas('barcodes')`, and a size's own row is one of those. So the parent was
found, `$variantId` stayed null, and the **variant fallback only runs when
nothing is found at all**. Scanning the 1L's own code rang the parent and the
till asked which size — holding the answer in its hand. That code was correct in
a world where no barcode row could name a variant, and that world only existed
because nothing wrote the column.

**Replacing the alternates wiped every size's code.** `$product->barcodes()` is
every row for the product, variant-scoped ones included, and the sync deleted the
lot before re-inserting. Scoped to `whereNull('variant_id')` now.

**The payload could not tell them apart.** The eager load selected
`barcodes:id,product_id,barcode` with no `variant_id`, so the panel's
"Additional barcodes" box would have listed every size's code and saved it back
as the product's — cutting each size loose from its own label, silently, with
nobody touching it.

## And the header had been promising it all along

The variant grid's second column was headed **"Code / barcode"** and stored the
SKU. It worked, after a fashion, because the till's fallback also matches a
variant SKU — so typing an EAN into the SKU box was the workaround, and the
header papered over it. Two columns now: **SKU** for the shop's own reference,
**Barcode** for what the scanner reads.

## One rule, one place

`BarcodeNamespace` owns both halves — what makes a code free, and assigning one
to a size. Two reasons it is not in either writer:

- the uniqueness rule was already needed by two callers, and two copies of "what
  makes a code free" is how one of them lets a scan ring the wrong line;
- **there are two paths that create variants.** `CreateProductAction` has its own
  loop and `SyncProductVariantsAction` has another, so a barcode written in only
  one of them exists after an edit and not after a create. The tests caught
  exactly that: the create path silently dropped every code until it called the
  shared writer too.

## The rule that needed a test to stay true

A blank barcode is **sent**, not omitted. An empty box is a shop saying the
packet no longer carries that code; dropping the key on empty makes the old code
permanent — they clear the field, save, and nothing happens. Mutating
`r.barcode !== undefined` to a truthy check kills that test.
