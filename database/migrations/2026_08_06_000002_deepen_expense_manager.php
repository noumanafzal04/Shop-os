<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Expense & Income Manager, second pass.
 *
 * The first pass recorded WHAT was spent. It never recorded HOW, and that gap
 * is the one that corrupts a drawer:
 *
 *   A shopkeeper pays the electricity bill with Rs 8,000 from the till. The
 *   expense is filed, the money is gone, and the drawer's expected cash still
 *   says the 8,000 is there. At close it reads as an 8,000 short — a variance
 *   nobody can explain, on the one number a shop uses to detect theft. Do that
 *   twice a week and the variance report becomes noise, which is worse than not
 *   having one.
 *
 * So an expense now carries a payment method, and a CASH one moves the drawer
 * through the same `expense_out` movement type that has been declared in
 * CashMovement since the beginning and never written. Income mirrors it with
 * `income_in` — rent received in cash is in the till the moment it's handed
 * over.
 *
 * Three more things a shop actually asks for, and why each is here:
 *
 *   ATTACHMENT   the photo of the bill. An expense without its receipt is an
 *                assertion; with it, it's a record.
 *   BUDGETS      a ceiling per category. Never blocks recording reality — a
 *                bill that arrived, arrived — but says so at the moment of
 *                entry, which is the only moment anyone can still act.
 *   RECURRING    rent, salaries, the internet bill. Templates that fall DUE
 *                and are posted by a human, deliberately not auto-posted: an
 *                expense that appears in the books because a clock ticked is
 *                an expense nobody checked against a bill.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('expenses', function (Blueprint $table): void {
            // How it was paid. Cash is the one that touches a drawer; the rest
            // are recorded for the books and leave the till alone.
            $table->string('payment_method', 20)->default('cash')->after('amount');
            // The drawer movement this expense created, when it was paid in
            // cash from an open till. Null means it never touched a drawer —
            // paid by card, by bank, or entered outside a shift.
            $table->uuid('cash_movement_id')->nullable()->after('payment_method');
            $table->foreignUuid('supplier_id')->nullable()->after('expense_category_id')
                ->constrained('suppliers')->nullOnDelete();
            $table->string('reference')->nullable()->after('description');   // bill / voucher no.
            $table->string('attachment_path')->nullable()->after('notes');
            $table->uuid('recurring_expense_id')->nullable()->after('attachment_path');

            $table->index(['tenant_id', 'cash_movement_id']);
        });

        Schema::table('incomes', function (Blueprint $table): void {
            $table->string('payment_method', 20)->default('cash')->after('amount');
            $table->uuid('cash_movement_id')->nullable()->after('payment_method');
            $table->string('reference')->nullable()->after('description');
            $table->string('attachment_path')->nullable()->after('notes');

            $table->index(['tenant_id', 'cash_movement_id']);
        });

        // ── Budgets ─────────────────────────────────────────────────
        Schema::create('expense_budgets', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignUuid('expense_category_id')->constrained('expense_categories')->cascadeOnDelete();
            $table->decimal('amount', 12, 2);
            // NULL = the standing monthly ceiling, applied to every month. A
            // dated row overrides it for that month alone — which is how a real
            // budget behaves: one number all year, except the month of the
            // annual licence renewal.
            $table->date('month')->nullable();
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'expense_category_id', 'branch_id', 'month'], 'expense_budgets_unique');
        });

        // ── Recurring templates ─────────────────────────────────────
        Schema::create('recurring_expenses', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignUuid('expense_category_id')->constrained('expense_categories')->cascadeOnDelete();
            $table->foreignUuid('supplier_id')->nullable()->constrained('suppliers')->nullOnDelete();
            $table->string('description');
            // The usual amount. Editable at the moment of posting, because the
            // electricity bill is never the same twice and a template that
            // forces last month's figure is a template that files a wrong one.
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

            $table->index(['tenant_id', 'is_active', 'next_due_on']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('recurring_expenses');
        Schema::dropIfExists('expense_budgets');

        Schema::table('incomes', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'cash_movement_id']);
            $table->dropColumn(['payment_method', 'cash_movement_id', 'reference', 'attachment_path']);
        });

        Schema::table('expenses', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'cash_movement_id']);
            $table->dropConstrainedForeignId('supplier_id');
            $table->dropColumn([
                'payment_method', 'cash_movement_id', 'reference',
                'attachment_path', 'recurring_expense_id',
            ]);
        });
    }
};
