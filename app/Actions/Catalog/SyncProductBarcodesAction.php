<?php

namespace App\Actions\Catalog;

use App\Exceptions\DomainException;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\ProductUnit;
use App\Models\ProductVariant;

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
            $clashesPrimary = Product::query()
                ->where('barcode', $barcode)
                ->whereKeyNot($product->id)
                ->exists();

            $clashesAlternate = ProductBarcode::query()
                ->where('barcode', $barcode)
                ->where('product_id', '!=', $product->id)
                ->exists();

            // A variant SKU or a pack barcode sharing this code would be
            // shadowed by this (product-level) alternate at scan time.
            $clashesVariant = ProductVariant::query()->where('sku', $barcode)->exists();
            $clashesUnit = ProductUnit::query()->where('barcode', $barcode)->exists();

            if ($clashesPrimary || $clashesAlternate || $clashesVariant || $clashesUnit) {
                throw DomainException::unprocessable(
                    "Barcode {$barcode} is already used as another item's code (product, variant, or pack).",
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
