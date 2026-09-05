<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * THE DELIVERY LEG, WRITTEN DOWN — without moving anything that already works.
 *
 * `OrderStatus` is NOT touched. The enum, its `nextStates()` table, every
 * transition test and the panel's status buttons stay exactly as they are:
 * preparing → out_for_delivery → completed is still the shop's flow, and a
 * shop with no app riders never sees a difference.
 *
 * What is added is the rider's own progress THROUGH that flow, as timestamps.
 * A stage is a fact about when something happened, not a second status column
 * that can disagree with the first:
 *
 *     rider_assigned_at   the shop (or the pool) gave it to somebody
 *     rider_accepted_at   they said yes on their phone
 *     picked_up_at        they have the food          → order: out_for_delivery
 *     delivered_at        it changed hands            → order: completed
 *
 * Two of those four also move the order status, through the existing
 * `OrderService::advance()`. The other two are the rider's own leg, which the
 * order status has never had a way to express.
 */
return new class extends Migration
{
    public function up(): void
    {
        // The bridge. A shop's rider card can now BE somebody with the app.
        Schema::table('riders', function (Blueprint $table): void {
            $table->foreignUuid('rider_profile_id')->nullable()->after('tenant_id')
                ->constrained('rider_profiles')->nullOnDelete();
            // The same person must not end up with two cards at one shop —
            // that is how a rider sees a job twice and the shop's list shows a
            // name it cannot tell apart. Null is exempt: a shop may have any
            // number of phone-call riders with no profile at all.
            $table->unique(['tenant_id', 'rider_profile_id']);
        });

        Schema::table('orders', function (Blueprint $table): void {
            $table->timestamp('rider_accepted_at')->nullable()->after('rider_assigned_at');
            // WHO CHOSE THIS RIDER. True = the rider took it off the pool
            // board themselves; false = a shop handed it to them.
            //
            // It decides what a hand-back means, and it cannot be inferred
            // afterwards: both paths write `rider_assigned_at`, often in the
            // same second. A pool job handed back returns to the pool; a job
            // the shop assigned keeps the shop's choice, because silently
            // unassigning it would hide the refusal from the person who made
            // that choice.
            $table->boolean('rider_self_claimed')->default(false)->after('rider_accepted_at');
            $table->timestamp('picked_up_at')->nullable()->after('rider_accepted_at');
            $table->timestamp('delivered_at')->nullable()->after('picked_up_at');

            // HANDOVER PROOF. Four digits shown to the customer once the order
            // is on its way; the rider types them at the door. It is the only
            // evidence the app has that a delivery marked complete actually
            // reached the person who paid for it — and with cash on delivery
            // that is also the moment the money moves.
            //
            // The shop can still complete an order from the panel without one,
            // which is the escape hatch for a customer whose phone is flat.
            $table->string('delivery_otp', 8)->nullable()->after('delivered_at');

            // Set when the shop takes the COD cash back off the rider.
            $table->foreignUuid('rider_settlement_id')->nullable()->after('delivery_otp');

            $table->index(['rider_id', 'status']);
        });
    }

    /**
     * ── The rollback, and why it is longer than the migration ────────
     *
     * `orders.rider_id` already carried a foreign key when this ran, and MySQL
     * requires an index to enforce one. It does not insist on its OWN index:
     * given `[rider_id, status]`, whose leftmost column is `rider_id`, it
     * adopts it and drops the single-column one it made earlier.
     *
     * So the obvious `down()` — drop the index, drop the columns — fails with
     *
     *     Cannot drop index 'orders_rider_id_status_index':
     *     needed in a foreign key constraint
     *
     * and it fails ONLY on MySQL. Under SQLite, which is what the test suite
     * runs on, the rollback was green from the first try. This was found by
     * running it against a real MySQL database, and it is the entire reason
     * that is worth doing.
     *
     * The fix is to release the constraint, drop the index, and put the
     * constraint back exactly as the earlier migration left it — which also
     * restores the index MySQL will make for it.
     */
    public function down(): void
    {
        $mysql = Schema::getConnection()->getDriverName() === 'mysql';

        Schema::table('orders', function (Blueprint $table) use ($mysql): void {
            if ($mysql) {
                $table->dropForeign(['rider_id']);
            }
            $table->dropIndex(['rider_id', 'status']);
            if ($mysql) {
                // Back to what `create_riders_table` left behind.
                $table->foreign('rider_id')->references('id')->on('riders')->nullOnDelete();
            }
        });

        Schema::table('orders', function (Blueprint $table): void {
            $table->dropColumn([
                'rider_accepted_at', 'rider_self_claimed', 'picked_up_at', 'delivered_at',
                'delivery_otp', 'rider_settlement_id',
            ]);
        });

        Schema::table('riders', function (Blueprint $table): void {
            $table->dropUnique(['tenant_id', 'rider_profile_id']);
            $table->dropConstrainedForeignId('rider_profile_id');
        });
    }
};
