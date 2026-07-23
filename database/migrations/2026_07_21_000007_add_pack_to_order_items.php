<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Online-order parity with the POS: an order line can be a pack (strip/box)
     * — same pack-breaking model. Stores which pack + how many base units it
     * represents so the hold/release/complete stock maths match the counter.
     */
    public function up(): void
    {
        Schema::table('order_items', function (Blueprint $table): void {
            $table->uuid('product_unit_id')->nullable()->after('variant_id');
            $table->string('unit_name')->nullable()->after('variant_name');
            $table->decimal('unit_factor', 12, 3)->default(1)->after('quantity');
        });
    }

    public function down(): void
    {
        Schema::table('order_items', function (Blueprint $table): void {
            $table->dropColumn(['product_unit_id', 'unit_name', 'unit_factor']);
        });
    }
};
