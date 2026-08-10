<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Paying the wholesaler is money leaving the shop, and the books never saw it.
 *
 * `RecordSupplierPaymentAction` wrote a SupplierPayment row, moved the PO's
 * amount_paid, and (for cash) recorded a drawer movement — but created no
 * Expense, and both the Cashbook and the Ledger read Expenses. For a mart the
 * supplier run is usually the single biggest outflow of the week, so the day it
 * happened reported money_out of zero and a net that was pure fiction.
 *
 * Fixed by making the payment its own money-out SOURCE rather than by
 * fabricating an Expense. That follows the precedent refunds already set: a
 * distinct kind of movement gets its own row, because inventing an Expense
 * double-counts the moment a shop also files the supplier's bill.
 *
 * The branch column is what lets that row be scoped like every other money row.
 * Historic payments are deliberately left NULL rather than backfilled to Main:
 * nothing recorded which till they came out of, and guessing would put another
 * shop's cash on a branch's page. NULL rows still appear in the all-branches
 * view, which is the only view that can honestly claim them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('supplier_payments', function (Blueprint $t): void {
            $t->foreignUuid('branch_id')->nullable()->after('tenant_id')
                ->constrained('branches')->nullOnDelete();
            // The shape both the cashbook and the ledger read: a tenant's
            // payments for one branch inside a date window.
            $t->index(['tenant_id', 'branch_id', 'paid_at']);
        });
    }

    public function down(): void
    {
        Schema::table('supplier_payments', function (Blueprint $t): void {
            $t->dropIndex(['tenant_id', 'branch_id', 'paid_at']);
            $t->dropConstrainedForeignId('branch_id');
        });
    }
};
