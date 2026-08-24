<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A recipe belonged to a DISH. So a pizzeria writing one recipe for a pizza
 * that comes in three sizes had every size draw the same flour: a Small took
 * a Large's dough out of stock, or a Large took a Small's, depending on which
 * size the recipe was written for. Measured before this ran — one Small and
 * one Large, both `2 dough`.
 *
 * A size is what a kitchen scales. So a recipe row may now name one.
 *
 * `variant_id` null keeps its old meaning exactly — the recipe for the dish,
 * whatever size — which is what every existing row is and must stay.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('recipe_items', function (Blueprint $table): void {
            $table->foreignUuid('variant_id')->nullable()->after('dish_product_id')
                ->constrained('product_variants')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('recipe_items', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('variant_id');
        });
    }
};
