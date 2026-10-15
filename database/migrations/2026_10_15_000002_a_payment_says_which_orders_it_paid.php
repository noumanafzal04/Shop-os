<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * WHICH ORDERS A SUPPLIER PAYMENT PAID, AND HOW MUCH OF EACH.
 *
 * The user (2026-10-15): a part payment's history — when, how much, how — was
 * shown nowhere on the supplier or the purchase order. A payment on account
 * that spread over several orders named none of them (`purchase_order_id`
 * null) and only raised each order's `amount_paid`, so no order could say
 * which payments made up what it shows as paid. One row per order a payment
 * touched, written where the payment is applied.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('supplier_payment_allocations', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('supplier_payment_id')->constrained('supplier_payments')->cascadeOnDelete();
            $table->foreignUuid('purchase_order_id')->constrained('purchase_orders')->cascadeOnDelete();
            $table->decimal('amount', 14, 2);
            $table->timestamps();

            $table->index(['tenant_id', 'purchase_order_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('supplier_payment_allocations');
    }
};
