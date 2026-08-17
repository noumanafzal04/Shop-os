<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Money that comes round again, on the side that was left out.
 *
 * ── Why only half of this existed ───────────────────────────────────────
 *
 * The expense manager's second pass gave rent, salaries and the internet bill
 * a template that falls due. Income got the same table, the same categories,
 * the same drawer link and the same branch scope — and no template at all.
 *
 * A shop's recurring income is not exotic. The unit upstairs let to a tenant,
 * the shutter rented to the phone-repair man, a monthly supply contract with
 * the school down the road, a fixed commission. Every one of them arrives on
 * the same day each month and had to be typed from scratch every time, while
 * the electricity bill three fields away offered itself.
 *
 * ── The design is copied on purpose ─────────────────────────────────────
 *
 * Deliberately the same shape as `recurring_expenses`, down to the column
 * names, because it is the same problem seen from the other side. Two screens
 * doing the same job with two different vocabularies is how one of them ends
 * up half-maintained — and this is a books module, where a shop reads both
 * sides of the same page.
 *
 * The one thing worth restating: **a template falls DUE, it does not post
 * itself.** Income that appears in the books because a clock ticked is income
 * nobody checked against a payment, and rent is exactly the thing that goes
 * unpaid quietly. The shop sees "2 due", confirms what actually arrived, and
 * posts.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('recurring_incomes', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignUuid('income_category_id')->nullable()
                ->constrained('income_categories')->nullOnDelete();
            $table->string('description');
            // The usual amount, and only that. A tenant who pays short this
            // month has paid short — a template that forces the agreed figure
            // files a receipt for money nobody received.
            $table->decimal('amount', 12, 2);
            $table->string('payment_method', 20)->default('cash');
            $table->string('frequency', 20);                 // weekly | monthly | quarterly | yearly
            $table->date('next_due_on');
            $table->date('last_posted_on')->nullable();
            $table->boolean('is_active')->default(true);
            $table->text('notes')->nullable();
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            // The one question the screen asks: what is due.
            $table->index(['tenant_id', 'is_active', 'next_due_on']);
        });

        Schema::table('incomes', function (Blueprint $table): void {
            // Which template filed it, so a posted row can be told from one
            // somebody typed — the same mark `expenses.recurring_expense_id`
            // carries, and for the same reason.
            $table->uuid('recurring_income_id')->nullable()->after('notes');
        });
    }

    public function down(): void
    {
        Schema::table('incomes', function (Blueprint $table): void {
            $table->dropColumn('recurring_income_id');
        });

        Schema::dropIfExists('recurring_incomes');
    }
};
