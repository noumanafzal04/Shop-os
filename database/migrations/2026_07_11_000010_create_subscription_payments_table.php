<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Billing ledger: one row per subscription payment. Who paid, how
        // much, for which period. Append-only history.
        Schema::create('subscription_payments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('plan_id')->nullable()->constrained('plans')->nullOnDelete();
            $table->string('plan_name');            // snapshot
            $table->decimal('amount', 12, 2);
            $table->string('currency', 3)->default('PKR');
            $table->string('method')->default('manual'); // cash|card|bank_transfer|manual|other
            $table->string('reference')->nullable();      // txn id / receipt no.
            $table->date('period_start');
            $table->date('period_end');
            $table->timestamp('paid_at');
            $table->uuid('recorded_by')->nullable(); // super admin / platform staff
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'paid_at']);
            $table->index('paid_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('subscription_payments');
    }
};
