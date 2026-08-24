<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * WHICH pizza is in the Family Deal.
 *
 * A deal listed its components by PRODUCT, and a product can have sizes. So a
 * deal containing a pizza did not say which pizza, and the sale had nothing to
 * take off the shelf: the deduction ran against the parent's `stock_quantity`,
 * which for a varianted product is an orphaned leftover that is always zero.
 *
 * The result was not a wrong number. It was a refusal:
 *
 *     Insufficient stock: only 0 in stock.
 *
 * on a shop with twenty pizzas on the shelf. A deal containing ANY sized product
 * could not be sold at all.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('combo_items', function (Blueprint $table) {
            // Nullable: most components have no sizes, and a deal naming one is
            // the exception rather than the rule. Where the component DOES have
            // sizes, SyncComboItemsAction refuses to save the line without it —
            // a deal nobody can sell should not be storable.
            $table->foreignUuid('variant_id')->nullable()->after('component_product_id')
                ->constrained('product_variants')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('combo_items', function (Blueprint $table) {
            $table->dropConstrainedForeignId('variant_id');
        });
    }
};
