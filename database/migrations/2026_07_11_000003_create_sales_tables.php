<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Per-tenant gap-free invoice sequence. The counter row is locked and
        // incremented INSIDE the sale transaction — a failed sale rolls the
        // increment back, so numbers never skip.
        Schema::create('invoice_counters', function (Blueprint $table) {
            $table->foreignUuid('tenant_id')->primary()->constrained('tenants')->cascadeOnDelete();
            $table->unsignedBigInteger('next_number')->default(1);
            $table->timestamps();
        });

        Schema::create('sales', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('invoice_number'); // e.g. INV-000001 (unique per tenant)
            $table->string('channel'); // walk_in | phone | whatsapp | online | pos
            $table->uuid('cash_session_id')->nullable()->index(); // POS shift the sale rang up on
            $table->string('status')->default('completed'); // completed | cancelled
            $table->string('customer_name')->nullable();
            $table->string('customer_phone', 32)->nullable();
            $table->string('order_type')->nullable(); // restaurants: dine_in | takeaway
            $table->string('table_no', 16)->nullable(); // dine-in table
            $table->decimal('subtotal', 12, 2);
            $table->decimal('discount', 12, 2)->default(0);
            $table->decimal('tax', 12, 2)->default(0);
            $table->decimal('total', 12, 2);
            $table->string('payment_method'); // cash | card | bank_transfer | other
            $table->decimal('amount_paid', 12, 2);
            $table->decimal('change_due', 12, 2)->default(0);
            $table->text('notes')->nullable();
            // Double-click "Complete Sale" / gateway retries → one sale only.
            $table->string('idempotency_key', 64)->nullable();
            $table->timestamp('sold_at');
            $table->timestamp('cancelled_at')->nullable();
            $table->uuid('cancelled_by')->nullable();
            $table->string('cancel_reason')->nullable();
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['tenant_id', 'invoice_number']);
            $table->unique(['tenant_id', 'idempotency_key']);
            $table->index(['tenant_id', 'sold_at']);
            $table->index(['tenant_id', 'status']);
        });

        Schema::create('sale_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('sale_id')->constrained('sales')->cascadeOnDelete();
            // Nullable FKs + snapshots: deleting a product never corrupts
            // past sales — the sale keeps its own copy of what was sold.
            $table->foreignUuid('product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->foreignUuid('variant_id')->nullable()->constrained('product_variants')->nullOnDelete();
            $table->string('product_name');
            $table->string('variant_name')->nullable();
            $table->json('modifiers')->nullable(); // chosen modifier/add-on snapshot
            $table->string('sku')->nullable();
            $table->string('item_type'); // product | service (snapshot)
            $table->decimal('quantity', 12, 3);
            $table->decimal('unit_price', 12, 2);
            $table->decimal('unit_cost', 12, 2)->nullable(); // for profit reports
            $table->decimal('line_discount', 12, 2)->default(0); // per-line POS discount
            $table->decimal('line_total', 12, 2);            // = unit_price*qty − line_discount
            $table->timestamps();

            $table->index(['tenant_id', 'sale_id']);
            $table->index(['tenant_id', 'product_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sale_items');
        Schema::dropIfExists('sales');
        Schema::dropIfExists('invoice_counters');
    }
};
