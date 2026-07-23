<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Scale PLU code: the short numeric code a weighing scale prints inside its
     * embedded barcode to identify a loose item (see App\Support\ScaleBarcode).
     * Unique per tenant so a scanned scale label resolves to exactly one item.
     */
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table): void {
            $table->string('plu_code')->nullable()->after('barcode');
            $table->unique(['tenant_id', 'plu_code']);
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table): void {
            $table->dropUnique(['tenant_id', 'plu_code']);
            $table->dropColumn('plu_code');
        });
    }
};
