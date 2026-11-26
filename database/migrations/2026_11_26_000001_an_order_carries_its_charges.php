<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * AN ORDER CARRIES ITS CHARGES — the market's rules for a delivery's price.
 *
 * "food panda agr koi order less than 200 ya 300 tk ho to extra charges leta
 * hai … agr koi 20 rs ka order kry ga to hum delivery thori dene jayen gy."
 *
 *   small_order_fee  a basket below the minimum pays the difference instead
 *                    of being refused (the shop's money — it is the shop's
 *                    minimum it makes up)
 *   distance_fee     the part of `delivery_fee` that is kilometres past the
 *                    distance the flat fee covers
 *   rush_fee         the part of `delivery_fee` the admin switched on for
 *                    rain or a rush
 *   service_fee      the platform's own charge on an online order
 *
 * `distance_fee` and `rush_fee` are INSIDE `delivery_fee` — written down so a
 * receipt can say what made it, while everything that already reads the
 * delivery fee (whose it is, what a rider hands in) keeps reading one number.
 *
 * And a customer may pay by TRANSFER (bank, JazzCash, Easypaisa — to the
 * shop's own account, outside the app): the reference they type, and the
 * shop's word that it arrived.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->decimal('small_order_fee', 12, 2)->default(0)->after('delivery_fee');
            $table->decimal('service_fee', 12, 2)->default(0)->after('small_order_fee');
            $table->decimal('distance_fee', 12, 2)->default(0)->after('service_fee');
            $table->decimal('rush_fee', 12, 2)->default(0)->after('distance_fee');
            $table->string('payment_reference', 60)->nullable()->after('payment_status');
            $table->timestamp('payment_verified_at')->nullable()->after('payment_reference');
            $table->foreignUuid('payment_verified_by')->nullable()->after('payment_verified_at')
                ->constrained('users')->nullOnDelete();
        });

        Schema::table('commission_charges', function (Blueprint $table): void {
            // The platform's service fee on the order, billed beside its
            // commission on the same invoice. `amount` is the two together.
            $table->decimal('service_fee', 12, 2)->default(0)->after('amount');
        });
    }

    public function down(): void
    {
        Schema::table('commission_charges', function (Blueprint $table): void {
            $table->dropColumn('service_fee');
        });
        Schema::table('orders', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('payment_verified_by');
            $table->dropColumn(['small_order_fee', 'service_fee', 'distance_fee', 'rush_fee', 'payment_reference', 'payment_verified_at']);
        });
    }
};
