<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * AN ORDER SAYS WHERE IT IS GOING, AND A PLACE CAN ASK FOR STOCK.
 *
 * Three shapes of business, and one of them was being assumed:
 *
 *   · no warehouse — the supplier's van comes to each branch (direct delivery);
 *   · a central warehouse — everything arrives there and goes on to the shops;
 *   · both — bread to the branch at six, cartons to the godown on Tuesday.
 *
 * A delivery went into whichever place the person receiving it was standing
 * in, which is the first shape and nothing else. A purchase order now carries
 * where it is to be delivered, decided when it is raised:
 *
 * `purchase_orders.deliver_to_branch_id` — null on every order that exists,
 * which reads as it always did: wherever it is received.
 *
 * `branches.takes_deliveries` — the one place a business may mark as where its
 * deliveries come. Marked, every new order starts addressed to it; unmarked,
 * an order starts addressed to whoever raises it. One per business at most,
 * held by the model the way Main is.
 *
 * ── And the other half of a warehouse ───────────────────────────────────
 *
 * A warehouse could SEND stock to a shop. A shop could not ask for it — and a
 * keeper pinned to the shop may not help themselves to the warehouse's shelf,
 * so the reorder list's "the godown has it" led to a button they could not
 * press. A transfer can now begin as a request: nothing moves, the sender
 * sees what was asked for, and sends it or does not.
 *
 * `stock_transfer_items.quantity_requested` is what was asked for, kept
 * beside what was actually sent. `stock_transfers.sent_by` is who sent it —
 * which used to be whoever created the row, and no longer is when the row was
 * created by the place asking.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('branches', function (Blueprint $table): void {
            $table->boolean('takes_deliveries')->default(false)->after('fills_orders');
        });

        Schema::table('purchase_orders', function (Blueprint $table): void {
            $table->foreignUuid('deliver_to_branch_id')->nullable()->after('supplier_id')
                ->constrained('branches')->nullOnDelete();
        });

        Schema::table('stock_transfers', function (Blueprint $table): void {
            $table->uuid('sent_by')->nullable()->after('sent_at');
        });

        Schema::table('stock_transfer_items', function (Blueprint $table): void {
            $table->decimal('quantity_requested', 12, 3)->nullable()->after('quantity');
        });

        // Every transfer so far was sent by whoever made it.
        DB::table('stock_transfers')->whereNull('sent_by')->update(['sent_by' => DB::raw('created_by')]);
    }

    public function down(): void
    {
        Schema::table('stock_transfer_items', function (Blueprint $table): void {
            $table->dropColumn('quantity_requested');
        });

        Schema::table('stock_transfers', function (Blueprint $table): void {
            $table->dropColumn('sent_by');
        });

        Schema::table('purchase_orders', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('deliver_to_branch_id');
        });

        Schema::table('branches', function (Blueprint $table): void {
            $table->dropColumn('takes_deliveries');
        });
    }
};
