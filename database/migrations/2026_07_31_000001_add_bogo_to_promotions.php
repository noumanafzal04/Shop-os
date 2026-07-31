<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Buy-X-get-Y support for promotions (type = 'bogo'). Buy `buy_qty` matching
 * units and `get_qty` of the CHEAPEST matching units come off at
 * `get_discount_pct` (100 = free, 50 = half off). Only meaningful for
 * category / product scope. The percent/fixed `value` column is unused for
 * bogo (stored as 0). PromotionService evaluates it authoritatively.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('promotions', function (Blueprint $table): void {
            $table->decimal('buy_qty', 12, 3)->nullable()->after('min_qty');
            $table->decimal('get_qty', 12, 3)->nullable()->after('buy_qty');
            $table->decimal('get_discount_pct', 5, 2)->nullable()->after('get_qty');
        });
    }

    public function down(): void
    {
        Schema::table('promotions', function (Blueprint $table): void {
            $table->dropColumn(['buy_qty', 'get_qty', 'get_discount_pct']);
        });
    }
};
