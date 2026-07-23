<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Variant-level batches. A medicine sold in variants (250mg / 500mg,
     * strip / box) has a separate expiry per variant — but batches were
     * product-level only, so variant stock skipped FEFO and the expiry fence.
     * A NULL variant_id keeps the existing product-level behaviour intact.
     */
    public function up(): void
    {
        Schema::table('product_batches', function (Blueprint $table): void {
            $table->foreignUuid('variant_id')->nullable()->after('product_id')
                ->constrained('product_variants')->nullOnDelete();
            $table->index(['tenant_id', 'product_id', 'variant_id'], 'pb_tenant_product_variant_idx');
        });
    }

    public function down(): void
    {
        Schema::table('product_batches', function (Blueprint $table): void {
            $table->dropIndex('pb_tenant_product_variant_idx');
            $table->dropConstrainedForeignId('variant_id');
        });
    }
};
