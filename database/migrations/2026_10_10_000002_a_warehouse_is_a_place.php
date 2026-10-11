<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A WAREHOUSE IS A PLACE THAT HOLDS STOCK AND DOES NOT SELL.
 *
 * Until now a godown was a branch like any other: it had a till it would
 * never open, it counted against the number of branches a plan allows, and an
 * online order could be routed to it because it happened to be nearest. A
 * single shop on the smallest plan could not have one at all.
 *
 * ── Not a second table ──────────────────────────────────────────────────
 *
 * Stock is already kept per place: `branch_stock`, lots, movements, counts,
 * write-offs and transfers all name a `branch_id`. A `warehouses` table would
 * mean every one of those learning two kinds of place, and a sale, a return
 * and a stocktake each asking which table a location lives in. So a place
 * gains a KIND, and everything that already knows where stock is keeps
 * knowing it.
 *
 * ── What moves with it ──────────────────────────────────────────────────
 *
 * `fills_orders` — whether online orders may be filled from here. True for a
 * shop, as it has always been. A warehouse says so for itself: a clothing
 * brand ships its online orders FROM the warehouse, a grocer's godown does not.
 *
 * `plans.max_warehouses` — beside `max_branches`, read the same way: null is
 * "this plan has no opinion" and the shop falls to the platform default.
 *
 * ── A transfer is sent, then received ───────────────────────────────────
 *
 * A transfer moved stock out of one place and into another in the same
 * instant. That is right when the godown is the room behind the shop, and
 * wrong when it is a van across the city: thirty cartons leave, twenty-eight
 * arrive, and the record said thirty arrived.
 *
 * So a transfer now carries when it was sent, when and by whom it was
 * received, and — per line — how much actually arrived, why not all of it,
 * and what was decided about the rest. `lots` is the batch and expiry of what
 * left, so a strip of medicine arrives with the date it was received under.
 *
 * Every transfer that exists today was an immediate move and stays
 * `completed`, received in full.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('branches', function (Blueprint $table): void {
            $table->string('kind', 16)->default('shop')->after('code');
            $table->boolean('fills_orders')->default(true)->after('is_active');
            $table->index(['tenant_id', 'kind']);
        });

        Schema::table('plans', function (Blueprint $table): void {
            $table->unsignedSmallInteger('max_warehouses')->nullable()->after('max_branches');
        });

        Schema::table('stock_transfers', function (Blueprint $table): void {
            $table->timestamp('sent_at')->nullable()->after('notes');
            $table->timestamp('received_at')->nullable()->after('sent_at');
            $table->uuid('received_by')->nullable()->after('received_at');
            $table->timestamp('settled_at')->nullable()->after('received_by');
            $table->uuid('settled_by')->nullable()->after('settled_at');
            $table->timestamp('cancelled_at')->nullable()->after('settled_by');
            $table->uuid('cancelled_by')->nullable()->after('cancelled_at');
            // "What is on its way to me" and "what is still unsettled" are
            // asked on every visit to the screen, by status.
            $table->index(['tenant_id', 'status']);
        });

        Schema::table('stock_transfer_items', function (Blueprint $table): void {
            // Which size. The product's name alone cannot tell a Medium from
            // a Large on a slip, and the size may be renamed or gone by the
            // time anyone reads it.
            $table->string('variant_name')->nullable()->after('product_name');
            $table->decimal('quantity_received', 12, 3)->nullable()->after('quantity');
            $table->string('short_reason', 24)->nullable()->after('quantity_received');
            $table->string('short_outcome', 24)->nullable()->after('short_reason');
            $table->json('lots')->nullable()->after('short_outcome');
            // Stock on the road is summed per product for the stock screens.
            $table->index(['tenant_id', 'product_id']);
        });

        // What already moved, moved whole.
        DB::table('stock_transfers')->whereNull('sent_at')->update([
            'sent_at' => DB::raw('created_at'),
            'received_at' => DB::raw('created_at'),
        ]);
        DB::table('stock_transfer_items')->whereNull('quantity_received')->update([
            'quantity_received' => DB::raw('quantity'),
        ]);
    }

    public function down(): void
    {
        Schema::table('stock_transfer_items', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'product_id']);
            $table->dropColumn(['variant_name', 'quantity_received', 'short_reason', 'short_outcome', 'lots']);
        });

        Schema::table('stock_transfers', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'status']);
            $table->dropColumn(['sent_at', 'received_at', 'received_by', 'settled_at', 'settled_by', 'cancelled_at', 'cancelled_by']);
        });

        Schema::table('plans', function (Blueprint $table): void {
            $table->dropColumn('max_warehouses');
        });

        Schema::table('branches', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'kind']);
            $table->dropColumn(['kind', 'fills_orders']);
        });
    }
};
