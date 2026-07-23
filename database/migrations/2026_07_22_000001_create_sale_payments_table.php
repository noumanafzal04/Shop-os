<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Multi-tender / split payment: one sale can be paid with several tenders
     * (part cash + part card, wallet, etc.). Each tender is a row here; the
     * sale keeps `payment_method` ('split' when mixed) + `amount_paid` as the
     * summary, while this table holds the breakdown for receipts, reports, and
     * cash-drawer reconciliation (only the CASH tenders count toward the till).
     */
    public function up(): void
    {
        Schema::create('sale_payments', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('sale_id')->constrained('sales')->cascadeOnDelete();
            $table->string('method'); // cash | card | bank_transfer | other
            $table->decimal('amount', 12, 2); // amount TENDERED in this method
            $table->string('reference')->nullable(); // card txn / transfer ref
            $table->timestamps();

            $table->index(['tenant_id', 'sale_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sale_payments');
    }
};
