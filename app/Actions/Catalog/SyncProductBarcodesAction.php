<?php

namespace App\Actions\Catalog;

use App\Exceptions\DomainException;
use App\Models\Product;
use App\Models\ProductBarcode;

/**
 * Replaces a product's alternate barcodes. A barcode must resolve to exactly
 * one item in the shop, so each is checked against every OTHER product's
 * primary barcode and every other product's alternates before it's saved.
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
            $clashesPrimary = Product::query()
                ->where('barcode', $barcode)
                ->whereKeyNot($product->id)
                ->exists();

            $clashesAlternate = ProductBarcode::query()
                ->where('barcode', $barcode)
                ->where('product_id', '!=', $product->id)
                ->exists();

            if ($clashesPrimary || $clashesAlternate) {
                throw DomainException::unprocessable(
                    "Barcode {$barcode} is already used by another product.",
                    'BARCODE_TAKEN',
                );
            }
        }

        // Replace the set.
        $product->barcodes()->delete();
        foreach ($clean as $barcode) {
            $product->barcodes()->create(['tenant_id' => $tenantId, 'barcode' => $barcode]);
        }
    }
}
