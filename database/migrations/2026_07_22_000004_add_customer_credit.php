<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Sell-on-credit (khata): a customer can take goods now and pay later.
     * `credit_balance` = what they currently owe (grows on a credit sale,
     * shrinks when they pay). `credit_limit` optionally caps the debt.
     * Every movement is written to `customer_ledger_entries` for a statement.
     */
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table): void {
            $table->decimal('credit_balance', 12, 2)->default(0)->after('notes');
            $table->decimal('credit_limit', 12, 2)->nullable()->after('credit_balance');
        });

        Schema::create('customer_ledger_entries', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('customer_id')->constrained('customers')->cascadeOnDelete();
            // A credit sale (charge, +owed) or a repayment / adjustment (−owed).
            $table->string('type'); // charge | payment | adjustment
            $table->decimal('amount', 12, 2);        // always positive
            $table->decimal('balance_after', 12, 2); // running balance snapshot
            $table->string('method')->nullable();    // for payments: cash | card | …
            $table->uuid('sale_id')->nullable()->index(); // the credit sale, if any
            $table->string('reference')->nullable();
            $table->string('note')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'customer_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_ledger_entries');
        Schema::table('customers', function (Blueprint $table): void {
            $table->dropColumn(['credit_balance', 'credit_limit']);
        });
    }
};
