<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenants', function (Blueprint $table) {
            // Flat delivery fee for online orders (0 = free / pickup only).
            $table->decimal('delivery_fee', 12, 2)->default(0)->after('online_shop_enabled');
        });

        Schema::create('orders', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('customer_id')->constrained('users')->cascadeOnDelete();
            $table->string('order_number'); // ORD-000001 per tenant
            $table->string('status')->default('pending')->index();
            // pending → confirmed → preparing → ready → out_for_delivery → completed
            //         ↘ cancelled
            $table->string('fulfillment_type'); // delivery | pickup
            $table->string('payment_method');   // cod | paid
            $table->string('payment_status')->default('unpaid'); // unpaid | paid
            $table->string('customer_name');
            $table->string('customer_phone', 32)->nullable();
            $table->string('delivery_address')->nullable();
            // Delivery pin — where the rider actually goes (set from the app's map).
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->decimal('subtotal', 12, 2);
            $table->decimal('delivery_fee', 12, 2)->default(0);
            $table->decimal('total', 12, 2);
            $table->text('notes')->nullable();
            $table->string('cancel_reason')->nullable();
            $table->foreignUuid('sale_id')->nullable()->constrained('sales')->nullOnDelete();
            $table->string('idempotency_key', 64)->nullable();
            $table->timestamp('placed_at');
            $table->timestamps();

            $table->unique(['tenant_id', 'order_number']);
            $table->unique(['tenant_id', 'idempotency_key']);
            $table->index(['tenant_id', 'status']);
            $table->index(['customer_id', 'status']);
        });

        Schema::create('order_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('order_id')->constrained('orders')->cascadeOnDelete();
            $table->foreignUuid('product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->foreignUuid('variant_id')->nullable()->constrained('product_variants')->nullOnDelete();
            $table->string('product_name');   // snapshot
            $table->string('variant_name')->nullable();
            $table->json('modifiers')->nullable(); // snapshot of chosen options
            $table->decimal('quantity', 12, 3);
            $table->decimal('unit_price', 12, 2); // base + modifier deltas
            $table->decimal('unit_cost', 12, 2)->nullable();
            $table->decimal('line_total', 12, 2);
            $table->timestamps();

            $table->index(['tenant_id', 'order_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_items');
        Schema::dropIfExists('orders');
        Schema::table('tenants', fn (Blueprint $t) => $t->dropColumn('delivery_fee'));
    }
};
