<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Multi-branch Phase 2 — per-branch stock.
 *
 * Stock becomes (product × variant × branch → qty), held in `branch_stock` as
 * the source of truth. `products.stock_quantity` (and each variant's) is kept
 * as a denormalised SUM-across-branches rollup so every existing read path
 * (marketplace visibility, low-stock lists, product display, reports) works
 * unchanged. FEFO lots (`product_batches`) and the ledger (`stock_movements`)
 * gain a `branch_id`. Everything is backfilled to each tenant's default "Main"
 * branch, so a single-branch tenant is byte-for-byte identical to before.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('branch_stock', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('branches')->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignUuid('variant_id')->nullable()->constrained('product_variants')->cascadeOnDelete();
            $table->decimal('quantity', 12, 3)->default(0);
            $table->timestamps();

            // One on-hand row per stock target per branch. variant_id NULL is
            // the product-level row (no variants); a variant carries its id.
            $table->unique(['branch_id', 'product_id', 'variant_id'], 'branch_stock_target_unique');
            $table->index(['tenant_id', 'product_id']);
        });

        Schema::table('product_batches', function (Blueprint $table) {
            $table->foreignUuid('branch_id')->nullable()->after('tenant_id')->constrained('branches')->nullOnDelete();
            $table->index(['branch_id', 'product_id']);
        });

        Schema::table('stock_movements', function (Blueprint $table) {
            $table->foreignUuid('branch_id')->nullable()->after('tenant_id')->constrained('branches')->nullOnDelete();
        });

        // ── Backfill: all existing stock lives at each tenant's Main branch ──
        foreach (DB::table('branches')->where('is_default', true)->get(['id', 'tenant_id']) as $main) {
            // Product-level on-hand (variant_id NULL).
            $products = DB::table('products')->where('tenant_id', $main->tenant_id)->get(['id', 'stock_quantity']);
            foreach ($products as $p) {
                DB::table('branch_stock')->insert([
                    'id' => (string) Str::orderedUuid(),
                    'tenant_id' => $main->tenant_id,
                    'branch_id' => $main->id,
                    'product_id' => $p->id,
                    'variant_id' => null,
                    'quantity' => $p->stock_quantity ?? 0,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }

            // Variant-level on-hand.
            $variants = DB::table('product_variants')
                ->join('products', 'product_variants.product_id', '=', 'products.id')
                ->where('products.tenant_id', $main->tenant_id)
                ->get(['product_variants.id', 'product_variants.product_id', 'product_variants.stock_quantity']);
            foreach ($variants as $v) {
                DB::table('branch_stock')->insert([
                    'id' => (string) Str::orderedUuid(),
                    'tenant_id' => $main->tenant_id,
                    'branch_id' => $main->id,
                    'product_id' => $v->product_id,
                    'variant_id' => $v->id,
                    'quantity' => $v->stock_quantity ?? 0,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }

            // Existing lots + ledger belong to Main.
            DB::table('product_batches')->where('tenant_id', $main->tenant_id)->update(['branch_id' => $main->id]);
            DB::table('stock_movements')->where('tenant_id', $main->tenant_id)->update(['branch_id' => $main->id]);
        }
    }

    public function down(): void
    {
        Schema::table('stock_movements', function (Blueprint $table) {
            $table->dropConstrainedForeignId('branch_id');
        });
        Schema::table('product_batches', function (Blueprint $table) {
            $table->dropConstrainedForeignId('branch_id');
        });
        Schema::dropIfExists('branch_stock');
    }
};
