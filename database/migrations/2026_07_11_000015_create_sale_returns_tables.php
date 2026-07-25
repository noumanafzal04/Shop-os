<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A return/refund against a completed sale — full or partial. Returned
        // stock flows back IN through the InventoryService write-path.
        Schema::create('sale_returns', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('sale_id')->constrained('sales')->cascadeOnDelete();
            $table->uuid('cash_session_id')->nullable()->index();
            $table->string('return_number'); // RET-000001
            $table->decimal('refund_total', 12, 2);           // GRAND refund (base + tax)
            $table->decimal('refund_tax', 12, 2)->default(0); // tax portion of refund_total
            // Portion settled against the customer's khata instead of paid
            // out: cash the cashier actually hands over = refund_total − this.
            $table->decimal('refund_credit', 12, 2)->default(0);
            $table->string('refund_method')->default('cash'); // cash | card | bank_transfer | other
            $table->string('reason')->nullable();
            $table->text('notes')->nullable();
            $table->timestamp('returned_at');
            $table->uuid('created_by')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'return_number']);
            $table->index(['tenant_id', 'sale_id']);
            // The cashbook buckets refunds by returned_at (and scans
            // returned_at < from for the opening balance) — index it.
            $table->index(['tenant_id', 'returned_at']);
        });

        Schema::create('sale_return_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('sale_return_id')->constrained('sale_returns')->cascadeOnDelete();
            $table->foreignUuid('sale_item_id')->nullable()->constrained('sale_items')->nullOnDelete();
            $table->foreignUuid('product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->foreignUuid('variant_id')->nullable()->constrained('product_variants')->nullOnDelete();
            $table->string('product_name');
            $table->string('variant_name')->nullable();
            $table->decimal('quantity', 12, 3);
            $table->decimal('unit_price', 12, 2);
            $table->decimal('line_total', 12, 2);
            $table->timestamps();

            $table->index('sale_return_id');
            $table->index('sale_item_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sale_return_items');
        Schema::dropIfExists('sale_returns');
    }
};
