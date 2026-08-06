<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What rounding did to a cash bill.
 *
 * Kept as its own column rather than folded into `total`, because `total` is
 * what tax was computed on and what the customer was charged — a settlement
 * convenience must never move either. This is the difference between the bill
 * and the notes that crossed the counter, so a receipt can print it, a report
 * can add it back, and a year of cash sales still reconciles to the paisa.
 *
 * Negative when the shop gave up the difference, positive when it collected
 * it. Zero for every sale ever rung before this shipped, and for every shop
 * that leaves rounding off.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sales', function (Blueprint $table): void {
            $table->decimal('rounding_adjustment', 12, 2)->default(0)->after('tip_amount');
        });
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table): void {
            $table->dropColumn('rounding_adjustment');
        });
    }
};
