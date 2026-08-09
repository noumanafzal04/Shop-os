<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The last money table that was still tenant-wide.
 *
 * Sales, expenses, income and cash sessions all carry a branch. Refunds did
 * not — so a branch-scoped Ledger could not exclude another branch's refunds
 * even in principle. It did not merely overstate the period: refunds before
 * the window land in the OPENING balance, so every row's running balance was
 * wrong for the whole page, on a screen whose entire purpose is that column.
 *
 * A refund belongs to the branch of the sale it reverses, not to whichever
 * till happened to hand the cash back. That is the only reading under which a
 * branch's takings and its refunds describe the same trade, so the backfill
 * and the write path both take it from the parent sale.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sale_returns', function (Blueprint $t): void {
            $t->foreignUuid('branch_id')->nullable()->after('tenant_id')
                ->constrained('branches')->nullOnDelete();
            // The ledger and cashbook both filter refunds by branch within a
            // date window; this is the shape both of those reads take.
            $t->index(['tenant_id', 'branch_id', 'returned_at']);
        });

        // Inherit from the parent sale. The subquery reads a DIFFERENT table
        // than the one being updated, so MySQL allows it and SQLite (tests)
        // runs the same statement — no dialect fork, no chunked PHP loop.
        DB::table('sale_returns')->whereNull('branch_id')->update([
            'branch_id' => DB::raw('(select branch_id from sales where sales.id = sale_returns.sale_id)'),
        ]);
    }

    public function down(): void
    {
        Schema::table('sale_returns', function (Blueprint $t): void {
            $t->dropIndex(['tenant_id', 'branch_id', 'returned_at']);
            $t->dropConstrainedForeignId('branch_id');
        });
    }
};
