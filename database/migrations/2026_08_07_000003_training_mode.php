<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Training mode — somewhere a new cashier can learn the till without it costing
 * anything.
 *
 * The unit is the SHIFT, not the sale. A per-sale switch lets practice and real
 * money mix in one drawer, and the mistake it invites — forgetting to switch
 * back — is exactly the one that must be impossible. So: you open a shift in
 * training, everything rung on it is practice, and you close it and open a real
 * one when you are done.
 *
 * A sale carries the flag too, copied from its shift at creation rather than
 * read through the join forever. A row that describes itself survives the shift
 * being deleted, and lets a global scope fence training out of every query
 * without a join.
 *
 * Two structural fences, chosen over "remember to filter it":
 *
 *   sales.is_training      a global scope on the model excludes these from
 *                          every query that does not explicitly opt in — the
 *                          same mechanism this codebase already trusts for
 *                          tenant isolation.
 *
 *   business_day_id NULL   a training shift belongs to no trading day, so the
 *                          day's roll-up and banking cannot reach it. It is not
 *                          filtered out of the day; it was never in it.
 *
 * Training invoices take their own sequence. The real one is gap-free on
 * purpose — a tax authority reads a hole in it as a deleted sale — and letting
 * practice consume numbers would punch holes in it every afternoon.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cash_sessions', function (Blueprint $table): void {
            $table->boolean('is_training')->default(false)->after('status');
        });

        Schema::table('sales', function (Blueprint $table): void {
            $table->boolean('is_training')->default(false)->after('status');
            $table->index(['tenant_id', 'is_training']);
        });

        Schema::table('invoice_counters', function (Blueprint $table): void {
            $table->unsignedBigInteger('training_next_number')->default(1)->after('next_number');
        });
    }

    public function down(): void
    {
        Schema::table('cash_sessions', function (Blueprint $table): void {
            $table->dropColumn('is_training');
        });

        Schema::table('sales', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'is_training']);
            $table->dropColumn('is_training');
        });

        Schema::table('invoice_counters', function (Blueprint $table): void {
            $table->dropColumn('training_next_number');
        });
    }
};
