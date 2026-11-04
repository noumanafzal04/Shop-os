<?php

namespace App\Actions\Catalog;

use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\ProductUnit;
use App\Models\ProductVariant;
use Illuminate\Support\Facades\DB;

/**
 * Gives an item a code it can be labelled with and scanned back at the till.
 *
 * AN ITEM IN SIZES IS SCANNED BY THE SIZE. A clothing shop sticks a ticket on
 * every size so the till rings the M without asking. This used to give the
 * whole kurta ONE code — so every label in the rack was the same, and every
 * scan stopped to ask which size. Now each active size without a code gets one
 * of its own: a `product_barcodes` row naming the size, which is the row the
 * scan lookup already resolves to that one size (VariantBarcodeTest). The
 * item's own code, if it has one, is left as it was.
 *
 * An item without sizes gets its own code, as before. Existing codes are kept
 * unless $force is set (the item's own code only — a size's printed ticket is
 * never silently replaced).
 */
class GenerateBarcodeAction
{
    public function execute(Product $product, bool $force = false): Product
    {
        $sizes = $product->variants()->where('is_active', true)->get(['id']);

        if ($sizes->isNotEmpty()) {
            DB::transaction(function () use ($product, $sizes): void {
                $coded = ProductBarcode::query()
                    ->where('product_id', $product->id)
                    ->whereNotNull('variant_id')
                    ->pluck('variant_id')
                    ->all();

                foreach ($sizes as $size) {
                    if (in_array($size->id, $coded, true)) {
                        continue;
                    }

                    ProductBarcode::query()->create([
                        'tenant_id' => $product->tenant_id,
                        'product_id' => $product->id,
                        'variant_id' => $size->id,
                        'barcode' => $this->uniqueCode($product->tenant_id),
                    ]);
                }
            });

            return $product;
        }

        if ($product->barcode !== null && ! $force) {
            return $product;
        }

        $product->forceFill(['barcode' => $this->uniqueCode($product->tenant_id)])->save();

        return $product;
    }

    /**
     * 12-digit numeric, free in EVERY place a scan is answered from — the item's
     * own code, its extra and size codes, a size's SKU and a pack's code
     * (BarcodeNamespace). Checking only the item's own code would let a new
     * code ring whichever namespace the lookup reached first.
     */
    private function uniqueCode(string $tenantId): string
    {
        do {
            $code = '2'.str_pad((string) random_int(0, 99999999999), 11, '0', STR_PAD_LEFT);
        } while ($this->taken($tenantId, $code));

        return $code;
    }

    private function taken(string $tenantId, string $code): bool
    {
        return Product::withoutTenancy()->where('tenant_id', $tenantId)->where('barcode', $code)->exists()
            || ProductBarcode::withoutTenancy()->where('tenant_id', $tenantId)->where('barcode', $code)->exists()
            || ProductVariant::withoutTenancy()->where('tenant_id', $tenantId)->where('sku', $code)->exists()
            || ProductUnit::withoutTenancy()->where('tenant_id', $tenantId)->where('barcode', $code)->exists();
    }
}
