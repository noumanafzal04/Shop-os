<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Immutable audit log of every stock change. Rows are never updated
        // or deleted — corrections are new counter-movements.
        Schema::create('stock_movements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignUuid('variant_id')->nullable()->constrained('product_variants')->cascadeOnDelete();
            $table->string('type'); // in | out | set
            $table->decimal('quantity_change', 12, 3); // signed delta actually applied
            $table->decimal('quantity_after', 12, 3);  // stock snapshot after applying
            $table->string('reason')->nullable();
            // Future linkage: sales (Step 9), reservations (Step 13) etc.
            $table->string('reference_type')->nullable();
            $table->uuid('reference_id')->nullable();
            // Client-supplied key: retries/double-taps never double-apply.
            $table->string('idempotency_key', 64)->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'idempotency_key']);
            $table->index(['tenant_id', 'product_id', 'created_at']);
            $table->index(['reference_type', 'reference_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_movements');
    }
};
