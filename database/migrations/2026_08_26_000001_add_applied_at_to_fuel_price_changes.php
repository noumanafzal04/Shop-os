<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * When a logged rate actually reached the pumps.
 *
 * A price notification is entered in the evening and takes effect at midnight —
 * the request that carries it says so in as many words. Until now the action
 * wrote the new price onto the product the moment it was logged, so every litre
 * a station sold that night went out at TOMORROW'S rate. On the night rates
 * change, that is the busiest a forecourt gets.
 *
 * Recording the rate and applying it are two different events, so they need two
 * different timestamps. `effective_at` is when the government says it starts;
 * `applied_at` is when this system actually moved the price.
 *
 * Existing rows are backfilled to their `effective_at`, which is true of every
 * one of them: the old code applied on the spot.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fuel_price_changes', function (Blueprint $table): void {
            $table->timestamp('applied_at')->nullable()->after('effective_at');
            $table->index(['applied_at', 'effective_at']);
        });

        // Everything already logged was applied when it was logged.
        DB::table('fuel_price_changes')->whereNull('applied_at')
            ->update(['applied_at' => DB::raw('effective_at')]);
    }

    public function down(): void
    {
        Schema::table('fuel_price_changes', function (Blueprint $table): void {
            $table->dropIndex(['applied_at', 'effective_at']);
            $table->dropColumn('applied_at');
        });
    }
};
