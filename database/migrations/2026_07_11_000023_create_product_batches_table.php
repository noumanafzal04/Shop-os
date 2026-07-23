<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Batch/lot tracking with expiry — pharmacies (mandatory) and any
        // perishable stock (grocery). Batch quantities live UNDER the product's
        // stock_quantity: adding a batch moves stock IN via InventoryService;
        // sales deplete batches FEFO (first-expiry-first-out), best effort.
        Schema::create('product_batches', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->string('batch_number');
            $table->date('expiry_date')->nullable();
            $table->decimal('quantity', 12, 3)->default(0); // remaining in this batch
            $table->decimal('cost', 12, 2)->nullable();     // per-unit cost for this lot
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'product_id']);
            $table->index(['tenant_id', 'expiry_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_batches');
    }
};
