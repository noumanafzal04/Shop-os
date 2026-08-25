<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * WHICH BRANCH FILLS THIS ORDER.
 *
 * Nothing on `orders` named a branch, so every online order in a chain was
 * answered by, held against and deducted from the tenant's DEFAULT branch —
 * whichever one happened to be marked Main. A shop with ten of something in
 * Gulberg and none in Main refused the order, correctly reporting "only 0 in
 * stock" about a shelf nobody was going to take the goods off anyway.
 *
 * That was recorded as a consequence rather than a design (see
 * `docs/decisions/shopos-one-branch-runs-out.md`), and this is the column that
 * turns it into one.
 *
 * NULLABLE, and it stays nullable. Orders placed before this migration were
 * genuinely fulfilled from the default branch and no honest value can be
 * invented for them now — backfilling Main would be a guess wearing a fact's
 * clothes, and every report that later grouped by branch would carry it. A
 * null here means "before this shop tracked it", and the reader is told so.
 *
 * `nullOnDelete`: a branch that closes must not take its order history with
 * it. The order still happened, and the money still moved.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->foreignUuid('branch_id')->nullable()->after('customer_id')
                ->constrained('branches')->nullOnDelete();
            // The question a chain asks of this column is "what did this branch
            // have to fill today", which is per tenant and per branch.
            $table->index(['tenant_id', 'branch_id'], 'orders_tenant_branch_index');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            // The index names the column, so it goes first — sqlite refuses to
            // drop a column an index still refers to, and that has bitten this
            // repo once already.
            $table->dropIndex('orders_tenant_branch_index');
            $table->dropConstrainedForeignId('branch_id');
        });
    }
};
