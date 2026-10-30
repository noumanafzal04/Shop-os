<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A PART CARRIES ITS WARRANTY WITHOUT A SERIAL (#SV3).
 *
 * A repair shop's bill is also its warranty slip — "3 months on this screen".
 * A warranty only lived on `sale_item_serials`, so a screen or a battery fitted
 * without an IMEI had nowhere to keep its promise and the invoice said nothing.
 * The line keeps the months it was sold with — a snapshot, so changing the
 * product's warranty later never rewrites a bill already handed over.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sale_items', function (Blueprint $table): void {
            $table->unsignedSmallInteger('warranty_months')->nullable()->after('tax_rate');
        });
    }

    public function down(): void
    {
        Schema::table('sale_items', function (Blueprint $table): void {
            $table->dropColumn('warranty_months');
        });
    }
};
