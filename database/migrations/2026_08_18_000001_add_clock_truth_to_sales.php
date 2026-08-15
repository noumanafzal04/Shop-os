<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What the till's own clock said, and how far out it was.
 *
 * ── Why a second timestamp, when `sold_at` already exists ───────────────
 *
 * `sold_at` decides everything that matters about a sale: its trading day, its
 * shift, whose figures it lands in, and whether the day it belongs to had
 * already been signed off. On the offline path that figure comes from a tablet,
 * and a tablet bought in a market and never set up can be days out — an Android
 * that lost its battery comes back believing it is the day it was manufactured.
 *
 * A sale filed three days back is not a small error. It lands in a business day
 * that has been counted and banked, it credits a shift that ended, and it makes
 * two days' takings wrong at once. So the moment is CORRECTED — the till applies
 * the drift it measured against the server, and the server refuses to file
 * anything in the future or before the till's own last contact with us.
 *
 * ── Why the wrong figure is kept ────────────────────────────────────────
 *
 * A correction nobody can see is a bug that never gets fixed. The tablet on
 * counter two goes on being three days out, every morning, for ever, because
 * the software quietly papers over it. `client_sold_at` is what that tablet
 * actually believed, and `clock_skew_seconds` is the gap — the number the
 * offline report names a till by so somebody walks over and sets its clock.
 *
 * Positive means the till was BEHIND. Negative means it was ahead.
 *
 * The third field of the triple — when it reached us — is `synced_at`, which
 * has been on this table since the day offline sales landed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sales', function (Blueprint $table): void {
            // Raw, uncorrected, straight off the tablet's own clock. Never used
            // for a figure — only for telling a shop its clock is wrong.
            $table->timestamp('client_sold_at')->nullable();
            // sold_at − client_sold_at, in whole seconds. Null on every sale
            // that was rung with a server in front of it, which is most of them.
            $table->integer('clock_skew_seconds')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table): void {
            $table->dropColumn(['client_sold_at', 'clock_skew_seconds']);
        });
    }
};
