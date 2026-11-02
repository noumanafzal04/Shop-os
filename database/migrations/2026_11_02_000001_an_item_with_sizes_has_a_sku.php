<?php

use App\Models\Product;
use App\Support\ParentSku;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * #GS5, the items already made.
 *
 * New items get a SKU the moment their first size or pack arrives (ParentSku).
 * Items made BEFORE that may still have sizes or packs and no SKU, and their
 * sizes drop out of every export. Each one is given its code here. The save
 * moves `updated_at`, so the offline tills hear of the new code too.
 */
return new class extends Migration
{
    public function up(): void
    {
        $hasChild = fn (string $table) => fn ($q) => $q->select(DB::raw(1))
            ->from($table)
            ->whereColumn($table.'.product_id', 'products.id')
            ->whereNull($table.'.deleted_at');

        Product::withoutGlobalScopes()
            ->whereNull('deleted_at')
            ->where(fn (Builder $q) => $q->whereNull('sku')->orWhere('sku', ''))
            ->where(fn (Builder $q) => $q->whereExists($hasChild('product_variants'))->orWhereExists($hasChild('product_units')))
            // By id, not by page: each save takes the item out of this very
            // filter, and an offset page would then skip as many as it fixed.
            ->lazyById(500)
            ->each(function (Product $product): void {
                if (ParentSku::give($product)) {
                    $product->save();
                }
            });
    }

    public function down(): void
    {
        // Not taken back: a code the shop may already have printed or exported.
    }
};
