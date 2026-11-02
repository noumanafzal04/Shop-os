<?php

namespace App\Support;

use App\Models\Product;
use App\Models\ProductUnit;
use App\Models\ProductVariant;

/**
 * An item with sizes or packs always has a SKU (#GS5).
 *
 * A size row and a pack row in the product sheet are tied to their item by the
 * item's SKU (`parent_sku`). An item with eight sizes and no SKU of its own was
 * exported as ONE row — its sizes had nothing to be named by, so they were left
 * out, and nothing said so. An export is also a shop's backup, so the sizes were
 * simply gone from it.
 *
 * Rather than warn about it, the gap is closed where it opens: the moment an
 * item gets its first size or pack and has no SKU, it is given one, and a SKU
 * cleared on such an item is kept. The rule lives on the MODELS (see
 * ProductVariant, ProductUnit and Product::booted) because sizes and packs have
 * several writers — the form, the edit, the import, the seeders — and a rule in
 * three of four writers is how this kind of gap comes back.
 *
 * The code is `ITEM-` and the last six characters of the item's own id: the
 * random end of the UUID, so items made in the same instant do not share it.
 * SKUs are unique across items AND sizes in one shop (StoreProductRequest), so
 * a code already taken there gets `-2`, `-3`… after it.
 */
final class ParentSku
{
    /**
     * Give the item a SKU if it has none. True when one was given.
     */
    public static function give(Product $product): bool
    {
        if (filled($product->sku)) {
            return false;
        }

        $product->sku = self::free($product);

        return true;
    }

    /**
     * After a size or pack is added: the parent, if it has no SKU, is given
     * one and saved.
     */
    public static function forParentOf(ProductVariant|ProductUnit $child): void
    {
        $product = $child->product;

        if ($product !== null && self::give($product)) {
            $product->save();
        }
    }

    /**
     * Does the item have a size or a pack still in use?
     */
    public static function hasChildren(Product $product): bool
    {
        return ProductVariant::withoutGlobalScopes()->where('product_id', $product->getKey())->whereNull('deleted_at')->exists()
            || ProductUnit::withoutGlobalScopes()->where('product_id', $product->getKey())->whereNull('deleted_at')->exists();
    }

    /**
     * The form's answer is built from the model it already held. When a size
     * written in the same request gave that item its SKU, the held copy still
     * says none — read the code back so the answer shows it.
     */
    public static function readBack(Product $product): void
    {
        if (filled($product->sku) || ! $product->exists) {
            return;
        }

        $sku = Product::withoutGlobalScopes()->whereKey($product->getKey())->value('sku');

        if (filled($sku)) {
            $product->sku = $sku;
            $product->syncOriginalAttribute('sku');
        }
    }

    private static function free(Product $product): string
    {
        $base = 'ITEM-'.strtoupper(substr(str_replace('-', '', (string) $product->getKey()), -6));
        $candidate = $base;
        $n = 2;

        while (self::taken((string) $product->tenant_id, $candidate, (string) $product->getKey())) {
            $candidate = $base.'-'.$n++;
        }

        return $candidate;
    }

    private static function taken(string $tenantId, string $sku, string $productId): bool
    {
        return Product::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('sku', $sku)
            ->whereKeyNot($productId)
            ->whereNull('deleted_at')
            ->exists()
            || ProductVariant::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('sku', $sku)
                ->whereNull('deleted_at')
                ->exists();
    }
}
