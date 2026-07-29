<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Multi-branch Phase 4c — per-branch price overrides.
 *
 * An optional override of a product's (or variant's) retail price at a single
 * branch. Effective price = branch override ?? tenant base. No row = the branch
 * uses the catalog price, so most product×branch combinations store nothing.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('branch_prices', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('branches')->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignUuid('variant_id')->nullable()->constrained('product_variants')->cascadeOnDelete();
            $table->decimal('price', 12, 2);
            $table->timestamps();

            // One override per branch × product × variant (null variant = product-level).
            $table->unique(['branch_id', 'product_id', 'variant_id']);
            $table->index(['tenant_id', 'product_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('branch_prices');
    }
};
