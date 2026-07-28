<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Recipe / bill-of-materials for a made-to-order dish: which raw ingredients
 * (and how much of each) one portion consumes. Mirrors combo_items, but the
 * semantics differ — a combo SELLS its components as a bundle, whereas a
 * recipe CONSUMES its ingredients' stock when the dish is sold. The dish
 * itself usually holds no stock (made to order).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('recipe_items', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            // The dish, and one raw ingredient it consumes.
            $table->foreignUuid('dish_product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignUuid('ingredient_product_id')->constrained('products')->cascadeOnDelete();
            $table->decimal('quantity', 12, 3)->default(1); // ingredient qty per one dish (base units)
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();

            $table->index(['tenant_id', 'dish_product_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('recipe_items');
    }
};
