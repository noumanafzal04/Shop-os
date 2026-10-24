<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Fuel rung at the till while no forecourt shift was open, counted by the
 * next shift to close (#P1). Written once at close, like every other figure
 * on the shift, so a signed-off night reads the same next year.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('forecourt_shifts', function (Blueprint $table): void {
            $table->decimal('between_litres', 14, 3)->default(0)->after('pos_fuel_litres');
            $table->decimal('between_value', 14, 2)->default(0)->after('between_litres');
        });
    }

    public function down(): void
    {
        Schema::table('forecourt_shifts', function (Blueprint $table): void {
            $table->dropColumn(['between_litres', 'between_value']);
        });
    }
};
