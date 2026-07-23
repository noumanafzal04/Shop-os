<?php

namespace App\Actions\Catalog;

use App\Models\Product;

/**
 * Assigns a unique numeric barcode to a product that lacks one, so it can be
 * printed on a label and scanned back at the POS. Existing barcodes are kept
 * unless $force is set.
 */
class GenerateBarcodeAction
{
    public function execute(Product $product, bool $force = false): Product
    {
        if ($product->barcode !== null && ! $force) {
            return $product;
        }

        $product->forceFill(['barcode' => $this->uniqueCode($product->tenant_id)])->save();

        return $product;
    }

    /** 12-digit numeric, unique within the tenant. */
    private function uniqueCode(string $tenantId): string
    {
        do {
            $code = '2'.str_pad((string) random_int(0, 99999999999), 11, '0', STR_PAD_LEFT);
        } while (
            Product::withoutTenancy()
                ->where('tenant_id', $tenantId)
                ->where('barcode', $code)
                ->exists()
        );

        return $code;
    }
}
