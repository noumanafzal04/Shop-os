<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A TANK IS DIPPED IN MILLIMETRES, NOT IN LITRES.
 *
 * The forecourt shipped asking for a closing dip in litres, and a dipstick
 * does not read in litres. A station reads a depth and looks it up on the
 * calibration chart that came with the tank — a printed table, because an
 * underground cylinder lying on its side holds a wildly different volume per
 * millimetre at the bottom, the middle and the top.
 *
 * So the operator was doing that lookup by hand, in the dark, at the end of a
 * shift, and typing the result into the ONE number the whole leak detection
 * rests on. A mis-read line on a paper chart and the shift reports fuel
 * missing that is not.
 *
 * This table is that chart: whatever points the station's own certificate
 * lists, at whatever spacing it lists them. Between two points the volume is
 * interpolated; OUTSIDE them it is refused rather than extrapolated, because a
 * depth the chart does not cover is either a mis-read stick or the wrong
 * chart, and both are worth stopping for.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fuel_tank_dip_points', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('fuel_tank_id')->constrained('fuel_tanks')->cascadeOnDelete();

            // Depth from the bottom of the tank. Whole millimetres — a chart is
            // never finer than that, and a float here would make two readings
            // of the same line fail to match.
            $table->unsignedInteger('mm');
            $table->decimal('litres', 12, 3);

            $table->timestamps();
            // Every model here soft-deletes, this one included. It is never
            // used — a chart is replaced whole, and the replace hard-deletes so
            // the unique key below stays true — but the column has to exist or
            // every read goes looking for it.
            $table->softDeletes();

            // One volume per depth. A chart with the same depth twice is a
            // paste that went wrong, and the second row would silently win.
            $table->unique(['fuel_tank_id', 'mm']);
            $table->index(['tenant_id', 'fuel_tank_id', 'mm']);
        });

        Schema::table('forecourt_dips', function (Blueprint $table): void {
            // WHAT THE OPERATOR ACTUALLY READ.
            //
            // The litres stay the figure everything reconciles against, because
            // that is what the rest of the shift is in. But they are DERIVED
            // here, and a derived number with no record of its source cannot be
            // re-checked: "the chart says 1,180 at 620mm" is answerable months
            // later and "the dip was 1,180" is not.
            //
            // Null where the station typed litres directly, which stays
            // allowed — a tank with no chart loaded still has to be dippable.
            $table->unsignedInteger('closing_dip_mm')->nullable()->after('closing_dip');
        });
    }

    public function down(): void
    {
        Schema::table('forecourt_dips', function (Blueprint $table): void {
            $table->dropColumn('closing_dip_mm');
        });
        Schema::dropIfExists('fuel_tank_dip_points');
    }
};
