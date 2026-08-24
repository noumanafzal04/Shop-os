<?php

namespace App\Actions\Catalog;

use App\Models\Product;
use App\Support\BarcodeNamespace;

/**
 * Replaces a product's alternate barcodes. A barcode must resolve to exactly
 * one item in the shop, so each is checked against every OTHER product's
 * primary barcode, every other product's alternates, AND the other code
 * namespaces the POS scan lookup consults — variant SKUs and pack (unit)
 * barcodes — before it's saved. Otherwise an alternate barcode could shadow a
 * variant or pack that shares the same code (the product-level match wins the
 * lookup), so scanning it would ring the wrong line.
 */
class SyncProductBarcodesAction
{
    /** @param string[] $barcodes */
    public function execute(Product $product, array $barcodes): void
    {
        $tenantId = $product->tenant_id;

        // Clean: trim, drop blanks, dedupe, and never store the product's own
        // primary barcode as an "extra".
        $clean = collect($barcodes)
            ->map(fn ($b) => trim((string) $b))
            ->filter()
            ->reject(fn ($b) => $b === $product->barcode)
            ->unique()
            ->values();

        foreach ($clean as $barcode) {
            // The rule lives in BarcodeNamespace, because per-SIZE barcodes need
            // exactly the same one and two copies of "what makes a code free" is
            // how one of them ends up allowing a scan that rings the wrong line.
            BarcodeNamespace::assertFree($barcode, $product);
        }

        // Replace the set — the PRODUCT-level set only.
        //
        // `barcodes()` is every row for this product, and a variant's own
        // barcode is one of those rows. Deleting them all here would wipe every
        // size's code the moment somebody edited the alternates, which is a
        // different form of the same bug this file was written to prevent.
        $product->barcodes()->whereNull('variant_id')->delete();
        foreach ($clean as $barcode) {
            $product->barcodes()->create(['tenant_id' => $tenantId, 'barcode' => $barcode]);
        }
    }
}
