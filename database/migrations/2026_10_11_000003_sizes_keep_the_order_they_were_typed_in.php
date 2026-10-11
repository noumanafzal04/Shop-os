<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * SIZES KEEP THE ORDER THEY WERE TYPED IN.
 *
 * A size had a name and no place, so every list of them was sorted by the
 * name: a kurta carded as S, M, L came back as L, M, S — on the till's
 * "which size?" sheet, on the edit grid, on the labels. Half and Full came
 * back as Full, Half; Small / Medium / Large as Large, Medium, Small. Nobody
 * hangs a rail, or writes a menu, in alphabetical order.
 *
 * `sort_order` is the position in the list the shop typed. Sizes with the same
 * position still fall back to the name, so anything written before this — or
 * by something that says no order — reads exactly as it did.
 *
 * Where a product kept the grid it was made from (`attributes.variant_axes`),
 * its existing sizes are put back in that grid's order here.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_variants', function (Blueprint $table): void {
            $table->unsignedSmallInteger('sort_order')->default(0)->after('name');
        });

        DB::table('products')
            ->whereNotNull('attributes')
            ->where('attributes', 'like', '%variant_axes%')
            ->orderBy('id')
            ->select(['id', 'attributes'])
            ->chunk(200, function ($products): void {
                foreach ($products as $product) {
                    $axes = json_decode((string) $product->attributes, true)['variant_axes'] ?? null;
                    if (! is_array($axes) || $axes === []) {
                        continue;
                    }

                    // Every combination, the first axis moving slowest — the
                    // order the grid drew them in, joined the way it names them.
                    $names = [[]];
                    foreach ($axes as $axis) {
                        $values = array_values(array_filter((array) ($axis['values'] ?? []), 'is_string'));
                        if ($values === []) {
                            continue;
                        }
                        $next = [];
                        foreach ($names as $so_far) {
                            foreach ($values as $value) {
                                $next[] = [...$so_far, $value];
                            }
                        }
                        $names = $next;
                    }

                    foreach ($names as $position => $parts) {
                        if ($parts === []) {
                            continue;
                        }
                        DB::table('product_variants')
                            ->where('product_id', $product->id)
                            ->where('name', implode(' / ', $parts))
                            ->update(['sort_order' => $position]);
                    }
                }
            });
    }

    public function down(): void
    {
        Schema::table('product_variants', function (Blueprint $table): void {
            $table->dropColumn('sort_order');
        });
    }
};
