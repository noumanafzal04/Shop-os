<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Multi-branch Phase 3 — branch-to-branch stock transfers. A transfer moves
 * quantity from one branch to another (out of source, into destination) via
 * the branch-aware InventoryService, with an audit record + line items.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stock_transfers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('reference'); // TRF-000001 per tenant
            $table->foreignUuid('from_branch_id')->constrained('branches')->cascadeOnDelete();
            $table->foreignUuid('to_branch_id')->constrained('branches')->cascadeOnDelete();
            $table->string('status')->default('completed'); // completed (immediate move)
            $table->string('notes')->nullable();
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['tenant_id', 'reference']);
            $table->index(['tenant_id', 'created_at']);
        });

        Schema::create('stock_transfer_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('stock_transfer_id')->constrained('stock_transfers')->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignUuid('variant_id')->nullable()->constrained('product_variants')->cascadeOnDelete();
            $table->string('product_name'); // snapshot
            $table->decimal('quantity', 12, 3);
            $table->timestamps();

            $table->index(['tenant_id', 'stock_transfer_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_transfer_items');
        Schema::dropIfExists('stock_transfers');
    }
};
