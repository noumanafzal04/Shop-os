<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * GOODS GO HOME NOW, AND ARE PAID FOR MONTH BY MONTH (F1).
 *
 * The owner, 2026-10-15: a shop gives goods on installments to many people —
 * how many months, how much each month, on which day — and could follow none of
 * it: a layaway keeps the goods in the shop, and khata has no schedule. "Market
 * standard" was the answer to how (Q12–Q15): the goods go out on the day, an
 * advance is taken, the rest is on the customer's khata, tied to this plan.
 *
 * Only the terms are stored. The schedule (month by month, what is due, what is
 * late) is worked out from them every time — `InstallmentSchedule` — so it
 * can never disagree with the payments. `paid` and `next_due_on` are kept on
 * the row for the lists to filter on, and rewritten after every payment.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('installment_plans', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('number', 30);
            $table->foreignUuid('customer_id')->constrained('customers')->cascadeOnDelete();
            // The sale that sent the goods home. Its khata charge IS the plan's
            // debt, and every installment is written against it.
            $table->foreignUuid('sale_id')->nullable()->constrained('sales')->nullOnDelete();
            $table->string('customer_name')->nullable();
            $table->string('customer_phone', 32)->nullable();
            $table->decimal('cash_price', 14, 2);
            $table->decimal('markup_percent', 5, 2)->default(0);
            $table->decimal('markup', 14, 2)->default(0);
            $table->decimal('total', 14, 2);
            $table->decimal('advance', 14, 2)->default(0);
            $table->decimal('financed', 14, 2);
            $table->unsignedSmallInteger('months');
            $table->decimal('monthly', 14, 2);
            $table->decimal('last_month', 14, 2);
            $table->date('first_due_on');
            $table->string('status', 20)->default('running');
            $table->decimal('paid', 14, 2)->default(0);
            $table->date('next_due_on')->nullable();
            $table->text('notes')->nullable();
            $table->timestamp('paid_off_at')->nullable();
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['tenant_id', 'number']);
            // The lists: running, late (next due before today), due this week.
            $table->index(['tenant_id', 'status', 'next_due_on']);
            $table->index(['tenant_id', 'customer_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('installment_plans');
    }
};
