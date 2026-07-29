<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Combo/recipe BOM snapshot per sale line. A deal or made-to-order dish holds
 * no stock of its own — selling it depletes each component/ingredient. To
 * restock a RETURN correctly even after the recipe/combo was later edited, we
 * snapshot the exploded composition (per-unit quantities) on the sale line at
 * sale time and restock from THAT, not the live recipe.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sale_items', function (Blueprint $table) {
            $table->json('components')->nullable()->after('modifiers');
        });
    }

    public function down(): void
    {
        Schema::table('sale_items', function (Blueprint $table) {
            $table->dropColumn('components');
        });
    }
};
