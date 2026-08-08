<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * How to take THIS medicine — "1 tablet twice daily after meals".
     *
     * Prescription capture already records who prescribed, for whom, and under
     * what number, but all of it lives on the SALE
     * (2026_07_22_000002_add_prescription_to_sales). A real prescription does
     * not work that way: the directions differ per medicine. One antibiotic is
     * a strict course, the painkiller beside it is as-needed, and a single
     * free-text note on the whole sale cannot express both.
     *
     * The consequence was that the one line a patient actually reads could not
     * be printed at all — the pharmacist writes it on the box by hand, and the
     * shop keeps no record of what was written.
     *
     * On the ITEM, not the product: the same medicine is dispensed with
     * different directions to different patients, so this is a fact about this
     * dispensing, not about the drug. Snapshotted like product_name and
     * unit_price beside it, so a later catalog edit cannot rewrite what a
     * patient was told.
     */
    public function up(): void
    {
        Schema::table('sale_items', function (Blueprint $table): void {
            $table->string('directions', 255)->nullable()->after('unit_name');
        });
    }

    public function down(): void
    {
        Schema::table('sale_items', function (Blueprint $table): void {
            $table->dropColumn('directions');
        });
    }
};
