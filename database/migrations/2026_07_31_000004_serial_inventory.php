<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Serial inventory — the on-hand registry for serialized goods.
 *
 * `sale_item_serials` already snapshots a serial at the moment of SALE (warranty
 * card / history). This adds a mutable stock registry so serials can be captured
 * when goods are RECEIVED and tracked in_stock → sold → back to in_stock on a
 * per-serial return. The POS can still type a serial that was never formally
 * received (legacy / walk-in) — the sale just records it as sold either way.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_serials', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->uuid('variant_id')->nullable();
            $table->uuid('branch_id')->nullable();
            $table->string('serial');
            $table->string('status')->default('in_stock');   // in_stock | sold
            $table->uuid('sale_id')->nullable();              // the sale it's currently out on
            $table->string('source')->nullable();             // purchase_order | opening | manual
            $table->uuid('source_id')->nullable();
            $table->timestamp('received_at')->nullable();
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            // A serial is unique per product within a tenant.
            $table->unique(['tenant_id', 'product_id', 'serial']);
            $table->index(['tenant_id', 'status']);
            $table->index(['tenant_id', 'serial']);
        });

        Schema::table('sale_item_serials', function (Blueprint $table): void {
            // Set when this sold unit is returned — frees it for resale and
            // marks the warranty record as returned.
            $table->timestamp('returned_at')->nullable()->after('sold_at');
            // Link to the stock registry row (null for legacy typed serials).
            $table->uuid('product_serial_id')->nullable()->after('variant_id');
        });
    }

    public function down(): void
    {
        Schema::table('sale_item_serials', function (Blueprint $table): void {
            $table->dropColumn(['returned_at', 'product_serial_id']);
        });
        Schema::dropIfExists('product_serials');
    }
};
