<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Pack-breaking (pharmacy & grocery): one product's stock is counted in a
     * single BASE unit (the smallest sellable — e.g. a tablet), but it can be
     * SOLD in several pack sizes that each map to a number of base units:
     *
     *     Panadol  base = tablet   Strip = 10 tablets   Box = 100 tablets
     *
     * product_units holds those larger packs. Selling one draws factor×qty from
     * the same base-unit pool, so a strip sold and a tablet sold both reduce the
     * one stock figure — no double counting.
     */
    public function up(): void
    {
        Schema::create('product_units', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->string('name');                    // Strip, Box, Carton…
            $table->decimal('factor', 12, 3);          // base units per one of this pack (> 1)
            $table->decimal('price', 12, 2)->nullable(); // explicit pack price; null → base price × factor
            $table->string('barcode')->nullable();     // a pack can carry its own barcode
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'product_id']);
            $table->index(['tenant_id', 'barcode']);
        });

        // The receipt/line snapshot needs to remember WHICH pack was sold and
        // how many base units it represented (for accurate returns & reports).
        Schema::table('sale_items', function (Blueprint $table): void {
            $table->string('unit_name')->nullable()->after('variant_name');
            $table->decimal('unit_factor', 12, 3)->default(1)->after('quantity');
        });
    }

    public function down(): void
    {
        Schema::table('sale_items', function (Blueprint $table): void {
            $table->dropColumn(['unit_name', 'unit_factor']);
        });
        Schema::dropIfExists('product_units');
    }
};
