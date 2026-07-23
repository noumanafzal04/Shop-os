<?php

namespace App\Actions\Catalog;

use App\Exceptions\DomainException;
use App\Models\Product;
use App\Models\ProductUnit;

/**
 * Replaces a product's pack units (pack-breaking). Each pack maps to a number
 * of base units (factor > 1) and may carry its own barcode — which, like a
 * product barcode, must resolve to exactly one item, so it's checked against
 * every other product's primary/alternate barcodes and packs.
 */
class SyncProductUnitsAction
{
    /** @param array<array{name?: string, factor?: mixed, price?: mixed, barcode?: mixed}> $units */
    public function execute(Product $product, array $units): void
    {
        $tenantId = $product->tenant_id;

        $clean = collect($units)
            ->map(fn ($u) => [
                'name' => trim((string) ($u['name'] ?? '')),
                'factor' => (float) ($u['factor'] ?? 0),
                'price' => isset($u['price']) && $u['price'] !== '' && $u['price'] !== null ? (float) $u['price'] : null,
                'barcode' => isset($u['barcode']) && trim((string) $u['barcode']) !== '' ? trim((string) $u['barcode']) : null,
            ])
            ->filter(fn ($u) => $u['name'] !== '' && $u['factor'] > 0)
            ->values();

        // A pack factor of 1 would just duplicate the base unit — reject it so
        // "1 tablet = 1 tablet" packs can't muddy pricing/stock maths.
        foreach ($clean as $u) {
            if ($u['factor'] <= 1) {
                throw DomainException::unprocessable(
                    "Pack \"{$u['name']}\" must hold more than one base unit.",
                    'UNIT_FACTOR_INVALID',
                );
            }
        }

        // Pack barcodes share the shop-wide barcode namespace (POS scans them).
        foreach ($clean->pluck('barcode')->filter() as $barcode) {
            $clash = Product::query()->where('barcode', $barcode)->whereKeyNot($product->id)->exists()
                || \App\Models\ProductBarcode::query()->where('barcode', $barcode)->where('product_id', '!=', $product->id)->exists()
                || ProductUnit::query()->where('barcode', $barcode)->where('product_id', '!=', $product->id)->exists();

            if ($clash) {
                throw DomainException::unprocessable(
                    "Barcode {$barcode} is already used by another product.",
                    'BARCODE_TAKEN',
                );
            }
        }

        $product->units()->delete();
        foreach ($clean as $i => $u) {
            $product->units()->create([
                'tenant_id' => $tenantId,
                'name' => $u['name'],
                'factor' => $u['factor'],
                'price' => $u['price'],
                'barcode' => $u['barcode'],
                'sort_order' => $i,
            ]);
        }
    }
}
