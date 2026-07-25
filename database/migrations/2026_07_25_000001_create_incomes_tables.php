<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The INCOME half of the Expense & Income module. Mirrors expenses /
 * expense_categories exactly. Income here is MANUAL, non-sales money in —
 * rent received, owner investment, a supplier refund, misc. POS/online sales
 * revenue is NEVER stored here (the Cashbook DERIVES it from sales) so nothing
 * double-counts.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('income_categories', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('name');
            $table->boolean('is_default')->default(false); // came from template
            $table->boolean('is_active')->default(true);
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'name']);
        });

        Schema::create('incomes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('income_category_id')->nullable()
                ->constrained('income_categories')->nullOnDelete();
            $table->string('description');
            $table->decimal('amount', 12, 2);
            $table->date('income_date');
            $table->text('notes')->nullable();
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'income_date']);
            $table->index(['tenant_id', 'income_category_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('incomes');
        Schema::dropIfExists('income_categories');
    }
};
