<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The index the cashbook and the ledger actually read by.
 *
 * Both scope a tenant's money to one branch inside a date window. `sale_returns`
 * got `(tenant_id, branch_id, returned_at)` when refunds gained a branch — but
 * the same query hits sales, expenses and incomes, and those were left with
 * `(tenant_id, date)` plus a lone `branch_id`. MySQL can use one of the two, so
 * a branch-scoped read on a chain with a year of trade filesorts the remainder.
 *
 * Invisible on a single-branch shop, which is why it lasted: `scopeId()` is null
 * there and the existing `(tenant_id, date)` index is exactly right.
 *
 * The old narrower indexes are left in place deliberately. `(tenant_id, date)`
 * still serves every all-branches read, which is the owner's default view, and
 * a composite leading with branch_id cannot answer it.
 */
return new class extends Migration
{
    /** table => [date column, existing index name to leave alone] */
    private const TABLES = [
        'sales' => 'sold_at',
        'expenses' => 'expense_date',
        'incomes' => 'income_date',
    ];

    public function up(): void
    {
        foreach (self::TABLES as $table => $dateColumn) {
            Schema::table($table, function (Blueprint $t) use ($table, $dateColumn): void {
                $t->index(['tenant_id', 'branch_id', $dateColumn], "{$table}_books_scope_index");
            });
        }
    }

    public function down(): void
    {
        foreach (array_keys(self::TABLES) as $table) {
            Schema::table($table, function (Blueprint $t) use ($table): void {
                $t->dropIndex("{$table}_books_scope_index");
            });
        }
    }
};
