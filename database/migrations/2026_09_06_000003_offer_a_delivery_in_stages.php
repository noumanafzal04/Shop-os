<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * NEAREST FIRST, WIDENING.
 *
 * The pool was an open board: the moment a shop accepted an order, every
 * platform rider within eight kilometres could see it and the first to tap
 * took it. Simple, and wrong in one specific way — the rider four hundred
 * metres away and the rider seven kilometres away had exactly the same claim,
 * so the food went to whoever happened to be looking at their phone.
 *
 * ── Why a RADIUS and not "the three nearest" ─────────────────────────
 *
 * "Offer it to the three nearest, then the next five" needs a table recording
 * which riders were offered what, kept in step with riders going offline
 * mid-offer. A widening radius achieves the same thing — the closest get first
 * refusal — with one nullable column and no state to fall out of step.
 *
 * It also degrades honestly. If nobody within three kilometres wants it, the
 * answer is not "ask three more people", it is "look further", which is what a
 * dispatcher would actually do.
 *
 * ── And why it is on the ORDER ───────────────────────────────────────
 *
 * The board reads it. Without the radius here, the staging would exist only in
 * the notifications: riders further out would be told late and still find the
 * job sitting on their board, which is a queue with no queue in it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            // How wide the offer currently is, in kilometres from the pickup.
            // NULL means this order is not on the pool board at all — either
            // nobody has offered it yet, or somebody is already carrying it.
            $table->decimal('offer_radius_km', 5, 1)->nullable()->after('rider_self_claimed');
            // When the widening began. The stage is derived from this and the
            // clock rather than stored, so a job that runs late cannot leave a
            // stale stage number behind.
            $table->timestamp('offered_at')->nullable()->after('offer_radius_km');

            $table->index(['offer_radius_km', 'status']);
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->dropIndex(['offer_radius_km', 'status']);
            $table->dropColumn(['offer_radius_km', 'offered_at']);
        });
    }
};
