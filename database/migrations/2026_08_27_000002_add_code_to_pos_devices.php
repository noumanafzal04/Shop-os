<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A SHORT CODE FOR A TILL, ALLOCATED RATHER THAN GUESSED.
 *
 * The offline slip a till prints is `OFF-<lane>-<device>-<counter>`, and that
 * device part was the first four characters of the random UUID the browser
 * minted for itself. Four characters is 65,536 values, and nothing anywhere
 * checked whether another till already had them: a shop with fifty tills had
 * roughly a one-in-fifty chance that two of them shared a segment, and from
 * their first sale each they would mint identical slip numbers for different
 * customers.
 *
 * A hash where an allocation belongs. Every real till system gives a terminal a
 * NUMBER — T01, T02 — precisely so this cannot happen, and this shop's devices
 * are already registered with the server, which is the only thing that can see
 * all of them at once and hand out one that is free.
 *
 * The slip's SHAPE does not change: four characters in, four characters out.
 * Only the guarantee behind them does.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pos_devices', function (Blueprint $table): void {
            $table->string('code', 4)->nullable()->after('name');

            // The guarantee itself. Per tenant, because that is the scope the
            // slip number is unique in — see sales.sales_tenant_offline_number_unique.
            $table->unique(['tenant_id', 'code'], 'pos_devices_tenant_code_unique');
        });
    }

    public function down(): void
    {
        Schema::table('pos_devices', function (Blueprint $table): void {
            $table->dropUnique('pos_devices_tenant_code_unique');
            $table->dropColumn('code');
        });
    }
};
