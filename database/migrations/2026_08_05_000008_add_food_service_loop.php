<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The food service loop — what happens between "send to kitchen" and the plate
 * reaching the table.
 *
 * Dine-in already had tables, tabs, KOTs and settlement, but a KOT was written
 * and then nothing ever advanced it: no station knew it was theirs, no screen
 * showed it, nobody bumped it, and the pass had no way to say "this is ready".
 * A restaurant does not run on the billing screen; it runs on that loop.
 *
 * What this adds:
 *  - a STATION per menu item, so one "fire" splits into the KOTs each section
 *    actually needs (the bar does not want the biryani ticket);
 *  - a bump lifecycle with timestamps, which is also the only honest way to
 *    answer "how long are we taking?";
 *  - a WAITER on the tab, so covers and sales attribute to whoever is serving
 *    rather than to whoever happened to open the tab;
 *  - a merge trail, so combining two tabs is not a silent deletion;
 *  - tips, which are money that arrives with the payment and must land in the
 *    drawer count without inflating the shop's revenue.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table): void {
            // Where this item is made: "Kitchen", "Bar", "Grill". Null = the
            // shop's default station (or no routing at all, for a shop that
            // never configured any).
            $table->string('kitchen_station')->nullable()->after('item_type');
        });

        Schema::table('restaurant_tickets', function (Blueprint $table): void {
            // Who is serving this table. Distinct from created_by: a tab opened
            // by the host at the door is served by someone else all evening.
            $table->uuid('waiter_id')->nullable()->after('guest_count');
            // Set on the tab that was absorbed, pointing at the survivor.
            $table->uuid('merged_into_id')->nullable()->after('sale_id');
            $table->timestamp('merged_at')->nullable()->after('merged_into_id');

            $table->index(['tenant_id', 'waiter_id']);
        });

        Schema::table('kitchen_tickets', function (Blueprint $table): void {
            // The bump trail. Separate columns rather than a single status
            // timestamp because the intervals between them ARE the report:
            // fired→preparing is how long a ticket sat, preparing→ready is the
            // cook time, ready→served is how long food waited on the pass.
            $table->timestamp('preparing_at')->nullable()->after('fired_at');
            $table->timestamp('ready_at')->nullable()->after('preparing_at');
            $table->timestamp('served_at')->nullable()->after('ready_at');
            $table->uuid('bumped_by')->nullable()->after('fired_by');

            // The kitchen screen reads "everything not yet served", constantly.
            $table->index(['tenant_id', 'status']);
        });

        Schema::table('sales', function (Blueprint $table): void {
            // A tip is money the customer handed over ON TOP of the bill. It is
            // NOT revenue and must never inflate `total` — but it is physically
            // in the drawer, so it has to be part of what was paid. Hence a
            // column of its own rather than a bigger total.
            $table->decimal('tip_amount', 12, 2)->default(0)->after('total');
        });
    }

    public function down(): void
    {
        Schema::table('products', fn (Blueprint $t) => $t->dropColumn('kitchen_station'));
        Schema::table('restaurant_tickets', function (Blueprint $t): void {
            $t->dropIndex(['tenant_id', 'waiter_id']);
            $t->dropColumn(['waiter_id', 'merged_into_id', 'merged_at']);
        });
        Schema::table('kitchen_tickets', function (Blueprint $t): void {
            $t->dropIndex(['tenant_id', 'status']);
            $t->dropColumn(['preparing_at', 'ready_at', 'served_at', 'bumped_by']);
        });
        Schema::table('sales', fn (Blueprint $t) => $t->dropColumn('tip_amount'));
    }
};
