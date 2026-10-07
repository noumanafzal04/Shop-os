<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A DAY CLOSED OFF BY MISTAKE, AND NO WAY BACK.
 *
 * Closing off the day is the sign-off on every drawer, and it is final on
 * purpose: a day signed in March reads the same in September. The
 * consequence nobody designed is the one a shop meets at two in the
 * afternoon — "Close off the day" pressed on the wrong screen, and with
 * "a shift must be open to sell" switched on the shop cannot ring another
 * sale until tomorrow. The product was right about the rule and had no
 * answer for the slip.
 *
 * So TODAY'S day can be opened again, by the people who may close it, with a
 * reason. Not yesterday's, and not once trading has moved on to a later day —
 * a day that has been lived past is signed off for good. See
 * App\Actions\Pos\ReopenBusinessDayAction.
 *
 * These three columns are what the Day screen says about it afterwards. The
 * figures the day was first signed off at are not kept here: they go to the
 * activity trail, which is where "who undid a sign-off, and what did it say"
 * is asked.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('business_days', function (Blueprint $table): void {
            $table->uuid('reopened_by')->nullable()->after('closed_by');
            $table->timestamp('reopened_at')->nullable()->after('closed_at');
            // WHY. A sign-off that was undone with no reason beside it is the
            // first thing an owner reading the trail would ask about.
            $table->string('reopen_reason', 255)->nullable()->after('reopened_at');
        });
    }

    public function down(): void
    {
        Schema::table('business_days', function (Blueprint $table): void {
            $table->dropColumn(['reopened_by', 'reopened_at', 'reopen_reason']);
        });
    }
};
