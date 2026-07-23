<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Combo/deal contents (FOOD): a "deal" product (item_type = deal) bundles
     * several other products at one price — "Burger + Fries + Drink = Rs 500".
     * The deal holds no stock of its own; selling it draws each component's
     * stock down by (component qty × deal qty).
     */
    public function up(): void
    {
        Schema::create('combo_items', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            // The deal product, and one of the products inside it.
            $table->foreignUuid('combo_product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignUuid('component_product_id')->constrained('products')->cascadeOnDelete();
            $table->decimal('quantity', 12, 3)->default(1); // how many of the component per deal
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();

            $table->index(['tenant_id', 'combo_product_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('combo_items');
    }
};
