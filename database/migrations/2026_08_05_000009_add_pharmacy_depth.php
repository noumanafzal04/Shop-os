<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Pharmacy depth — the three things a chemist does that no other shop does.
 *
 * 1. SUBSTITUTION. The brand on the prescription is out; an equivalent with the
 *    same salt and strength is on the shelf. `generic_name` and `strength`
 *    already exist on products — what was missing was any way to ASK the
 *    question at the counter, which is a query, not a column.
 *
 * 2. THE DISPENSING REGISTER. A controlled drug must be recorded: what was
 *    dispensed, to whom, on whose prescription, from which batch, by whom.
 *    `drug_schedule` is what marks a product as needing that treatment, and it
 *    is nullable so nothing changes for a shop that never sets it.
 *
 * 3. RECALL. A manufacturer withdraws a batch and the shop must find everyone
 *    who got it. Stock already depletes FEFO, but which batches a movement ate
 *    was thrown away the moment it happened — so the question was unanswerable.
 *    `batch_allocations` records it on the movement, where it belongs: the
 *    consumption is a stock fact, not a pricing one, and recording it there
 *    traces returns and wastage as well as sales.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table): void {
            // Pakistan's Drugs Act schedules (G / H / X …) and their local
            // equivalents. Free text rather than an enum: the classification is
            // a regulator's list, not ours, and it changes without us.
            $table->string('drug_schedule')->nullable()->after('requires_prescription');
            $table->index(['tenant_id', 'generic_name']);
        });

        Schema::table('stock_movements', function (Blueprint $table): void {
            // [{batch_number, expiry_date, quantity}] — the lots this movement
            // actually consumed or restored. Null for stock that isn't
            // batch-tracked, which is most of a mart's shelf.
            $table->json('batch_allocations')->nullable()->after('reason');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'generic_name']);
            $table->dropColumn('drug_schedule');
        });
        Schema::table('stock_movements', fn (Blueprint $t) => $t->dropColumn('batch_allocations'));
    }
};
