<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * AN ITEM CAN BE KEPT AND NOT SOLD.
 *
 * Flour for the parathas is counted, bought and used up by a recipe, and is
 * never sold across the counter. The catalogue had no way to say so: it was
 * offered on the till and in the till's search at 0 (tester pass 5, B62).
 * Every item is for sale until its maker says otherwise.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table): void {
            $table->boolean('for_sale')->default(true)->after('is_active');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table): void {
            $table->dropColumn('for_sale');
        });
    }
};
