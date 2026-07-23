<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A second named price list: "Wholesale". Retail = the product's normal
     * price; Wholesale = this flat rate. At the POS the cashier picks a price
     * LEVEL per line (retail/wholesale) — the price still comes from the
     * product's own stored figure, never typed by hand, so pricing stays
     * server-authoritative. Null = this item has no wholesale price (retail only).
     */
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table): void {
            $table->decimal('wholesale_price', 12, 2)->nullable()->after('discount_price');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table): void {
            $table->dropColumn('wholesale_price');
        });
    }
};
