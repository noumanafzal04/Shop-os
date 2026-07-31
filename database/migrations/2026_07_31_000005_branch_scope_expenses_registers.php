<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Branch-scope the money records that were still tenant-wide: expenses, other
 * income, and cash-drawer sessions (the register). Each is stamped with the
 * OPERATING branch when created, so a per-branch P&L can deduct that branch's
 * costs and a shift belongs to the till it was opened on. Null = legacy /
 * headless (rolls up under the whole tenant, as before).
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['expenses', 'incomes', 'cash_sessions'] as $table) {
            Schema::table($table, function (Blueprint $t): void {
                $t->foreignUuid('branch_id')->nullable()->after('tenant_id')
                    ->constrained('branches')->nullOnDelete();
            });
        }
    }

    public function down(): void
    {
        foreach (['expenses', 'incomes', 'cash_sessions'] as $table) {
            Schema::table($table, function (Blueprint $t): void {
                $t->dropConstrainedForeignId('branch_id');
            });
        }
    }
};
