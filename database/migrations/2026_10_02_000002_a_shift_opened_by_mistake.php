<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A SHIFT OPENED BY MISTAKE, AND NO WAY OUT OF IT.
 *
 * One forecourt, one open shift — the server says so, and it is right: two
 * would each hold a claim on the same meters and neither could be
 * reconciled. The consequence nobody designed is that a shift opened in
 * error BLOCKS THE WHOLE FORECOURT until it is closed, and closing demands a
 * closing reading for every nozzle and a dip for every tank.
 *
 * So the manager who pressed the button at the wrong station has two bad
 * choices: invent a set of closing figures, which puts a reconciliation that
 * never happened into the month's fuel report for ever; or leave it open,
 * which stops the real shift from being opened at all. On a station that
 * runs three shifts a day, that is the night's trading.
 *
 * ── What this adds ──────────────────────────────────────────────────────
 *
 * A third status, `cancelled`, and the two columns that make it safe to
 * reach: a shift CAN be abandoned, but only back to exactly the state the
 * forecourt was in before it opened.
 *
 * Opening a shift may MOVE the plant — an opening reading above the
 * nozzle's last one winds the totaliser forward, and an opening dip
 * overwrites the tank's. Those are the only two things it changes, and
 * until now the previous values were simply overwritten. Cancelling without
 * them would leave a nozzle reading and a tank dip that no shift accounts
 * for, which is the same leak the module exists to detect.
 *
 * Null on every row written before this: a shift opened yesterday cannot be
 * cancelled, and the action says so rather than guessing a number to put
 * back. That is the honest answer — a cancel that restores a figure it
 * invented is worse than no cancel at all.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('forecourt_readings', function (Blueprint $table): void {
            // The totaliser as it stood BEFORE this shift claimed the nozzle.
            // Equal to `opening_reading` in the ordinary case; different only
            // when somebody keyed an opening figure, which is exactly the
            // case a cancel has to undo.
            $table->decimal('previous_reading', 14, 3)->nullable()->after('opening_reading');
        });

        Schema::table('forecourt_dips', function (Blueprint $table): void {
            $table->decimal('previous_dip', 12, 3)->nullable()->after('opening_dip');
        });

        Schema::table('forecourt_shifts', function (Blueprint $table): void {
            $table->uuid('cancelled_by')->nullable()->after('closed_by');
            $table->timestamp('cancelled_at')->nullable()->after('closed_at');
            // WHY. A cancelled shift stays on the list, and a row that
            // vanished would be worse: the next person needs to see that
            // somebody opened this station at 6am and abandoned it, not an
            // unexplained gap in the numbering.
            $table->string('cancel_reason', 255)->nullable()->after('cancelled_at');
        });
    }

    public function down(): void
    {
        Schema::table('forecourt_shifts', function (Blueprint $table): void {
            $table->dropColumn(['cancelled_by', 'cancelled_at', 'cancel_reason']);
        });

        Schema::table('forecourt_dips', function (Blueprint $table): void {
            $table->dropColumn('previous_dip');
        });

        Schema::table('forecourt_readings', function (Blueprint $table): void {
            $table->dropColumn('previous_reading');
        });
    }
};
