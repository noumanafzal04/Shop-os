<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A CUSTOMER CAN REPORT A PROBLEM WITH AN ORDER — something missing, the wrong
 * thing, late, cold, the rider, the payment — and the platform answers it: a
 * refund, a voucher at that shop, or a reasoned no. One report per order.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('order_issues', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('order_id')->unique()->constrained('orders')->cascadeOnDelete();
            $table->foreignUuid('customer_id')->constrained('users')->cascadeOnDelete();
            // missing_item | wrong_item | late | quality | rider | payment | other
            $table->string('kind', 20);
            $table->string('note', 1000)->nullable();
            // open | resolved | rejected
            $table->string('status', 12)->default('open');
            // refund | voucher | none — what was done, once resolved
            $table->string('outcome', 12)->nullable();
            $table->decimal('amount', 12, 2)->nullable();
            $table->string('voucher_code', 40)->nullable();
            $table->string('answer', 1000)->nullable();
            $table->foreignUuid('resolved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();

            $table->index(['status', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_issues');
    }
};
