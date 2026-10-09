<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A plan says which modules it includes; a shop may have its own price for an
 * add-on.
 *
 * `plans.modules` — a list of module keys, or NULL for "whatever this rung of
 * the ladder includes" (see `ModulePackages::LADDER`). NULL is the state every
 * existing plan is in, and it is a real answer rather than a missing one: the
 * ladder can be re-thought in code without rewriting a row.
 *
 * It is a starting point and a label — never the gate. What a shop may use is
 * still `tenants.features`. Nothing reads this column at request time.
 *
 * `tenants.addon_prices` — module key => rupees a month, for the shop that was
 * given its own price for an add-on (or given one free). NULL, or a key left
 * out, means the platform's price.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('plans', function (Blueprint $table): void {
            $table->json('modules')->nullable()->after('retention_months');
        });

        Schema::table('tenants', function (Blueprint $table): void {
            $table->json('addon_prices')->nullable()->after('limits');
        });
    }

    public function down(): void
    {
        Schema::table('tenants', function (Blueprint $table): void {
            $table->dropColumn('addon_prices');
        });

        Schema::table('plans', function (Blueprint $table): void {
            $table->dropColumn('modules');
        });
    }
};
