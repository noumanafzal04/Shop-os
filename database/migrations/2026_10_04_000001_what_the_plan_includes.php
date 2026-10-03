<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * WHAT A PLAN ACTUALLY INCLUDES.
 *
 * A plan sold a price, a product ceiling and a retention window. The three
 * numbers a shopkeeper asks about first — how many branches, how many staff
 * logins, how many tills — were not on it at all: they were assigned to each
 * shop by hand, one at a time.
 *
 * Which meant the plans were not really different from each other. "Basic"
 * and "Enterprise" gave the same one branch and the same five staff until an
 * admin remembered to type otherwise, so the difference between them existed
 * only in a salesperson's head and in whatever they happened to key in that
 * afternoon.
 *
 * ── Null is NOT unlimited here, and that is the whole subtlety ──────────
 *
 * On `max_products` null means unlimited. On these three it means "this plan
 * has no opinion", and the shop falls to the platform default it already had
 * — 1 branch, 5 staff, 2 lanes.
 *
 * That asymmetry is deliberate and it is what makes this migration safe:
 * every plan that exists today gets null in every column here, so every shop
 * on them keeps exactly the ceiling it has this morning. Nothing is narrowed,
 * nothing is widened, and the admin's per-shop override still beats the plan
 * — see `PlanLimits::baseline`.
 *
 * ── Two more, for the same reason ──────────────────────────────────────
 *
 * `max_offline_selling` and `max_offline_days` put offline trading on the
 * ladder. It is the one CAPABILITY a plan gates, and the exception is
 * deliberate: a module describes the SHAPE of a trade — a pharmacy has no use
 * for a kitchen docket — while offline selling is wanted by every shop in the
 * country and costs real money to support. That makes it a rung, not a shape.
 *
 * ── And the room after the ceiling ─────────────────────────────────────
 *
 * `grace_orders_month` is how far past the included bills a shop may go
 * before anyone calls the number exhausted. A till that refuses at 5,000 on
 * the 22nd is a shop with customers in it and goods on the counter, and
 * whatever that saves in hosting it costs twenty times over in the phone
 * call. The meter counts, the warnings sharpen, the till keeps ringing.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('plans', function (Blueprint $table): void {
            $table->unsignedSmallInteger('max_branches')->nullable()->after('max_products');
            $table->unsignedSmallInteger('max_staff')->nullable()->after('max_branches');
            $table->unsignedSmallInteger('max_registers')->nullable()->after('max_staff');
            $table->unsignedTinyInteger('max_offline_selling')->nullable()->after('max_registers');
            $table->unsignedSmallInteger('max_offline_days')->nullable()->after('max_offline_selling');
            $table->unsignedInteger('grace_orders_month')->nullable()->after('max_orders_month');
        });
    }

    public function down(): void
    {
        Schema::table('plans', function (Blueprint $table): void {
            $table->dropColumn([
                'max_branches', 'max_staff', 'max_registers',
                'max_offline_selling', 'max_offline_days', 'grace_orders_month',
            ]);
        });
    }
};
