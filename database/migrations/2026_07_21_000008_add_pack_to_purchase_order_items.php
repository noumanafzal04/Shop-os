<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Buy stock in packs (MART/pharmacy): a PO line can be ordered in a pack
     * (e.g. 5 Boxes) at the pack cost. quantity_ordered/received are in that
     * pack; on receipt stock lands in BASE units (qty × factor) — "5 boxes →
     * 500 tablets". unit_factor = base units per pack (1 = ordered in base).
     */
    public function up(): void
    {
        Schema::table('purchase_order_items', function (Blueprint $table): void {
            $table->uuid('product_unit_id')->nullable()->after('variant_id');
            $table->string('unit_name')->nullable()->after('variant_name');
            $table->decimal('unit_factor', 12, 3)->default(1)->after('quantity_received');
        });
    }

    public function down(): void
    {
        Schema::table('purchase_order_items', function (Blueprint $table): void {
            $table->dropColumn(['product_unit_id', 'unit_name', 'unit_factor']);
        });
    }
};
