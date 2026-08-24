---
name: shopos-code-for-each-size
description: FIXED — the till read product_barcodes.variant_id since the column existed and NOTHING wrote it; writing it exposed three more bugs that were correct in the old world
metadata:
  type: project
---

The till has resolved a scan to ONE SIZE through `product_barcodes.variant_id`
since the column existed. **Nothing ever wrote it** — every alternate barcode was
created with `['tenant_id','barcode']`, so all of them belonged to the parent.

So a drinks shop could not put the 500ml's EAN on the 500ml and the 1L's on the
1L, which is the entire reason those two codes are printed. Same for a chemist's
strip and box, a garment's size tickets. Reader with no writer — see
[[shopos-reachability-rule]].

**Writing it exposed three more, each correct in the old world:**

- the parent match SWALLOWED the code. The lookup finds a product via
  `orWhereHas('barcodes')` and a size's row is one of those, so the variant
  fallback — which only runs when nothing is found at all — never ran;
- replacing the alternates WIPED every size's code (`$product->barcodes()` is
  every row); now scoped to `whereNull('variant_id')`;
- the payload selected `barcodes:id,product_id,barcode` with no `variant_id`, so
  the panel's "Additional barcodes" box would have listed each size's code and
  saved it back as the product's — cutting every size loose from its own label,
  silently.

**The grid header had been promising it all along:** the column read
"Code / barcode" and stored the SKU. It half-worked because the till's fallback
also matches a variant SKU. Two columns now — SKU, and Barcode. See
[[shopos-promise-in-another-file]].

**`BarcodeNamespace` owns the rule AND the writer.** There are two paths that
create variants — `CreateProductAction` has its own loop,
`SyncProductVariantsAction` has another — and the first version wrote barcodes on
edit and not on create. The tests caught it at once.

**A blank barcode is SENT, not omitted.** An empty box means "the packet no
longer carries that code"; dropping the key on empty makes the old one permanent.
Its test dies if `!== undefined` becomes a truthy check.
