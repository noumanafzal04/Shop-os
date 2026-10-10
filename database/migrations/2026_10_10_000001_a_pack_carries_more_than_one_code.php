<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A PACK CARRIES MORE THAN ONE CODE.
     *
     * A carton of 24 has the manufacturer's outer code on it. It may also have
     * the distributor's own, last year's artwork with last year's number, and
     * the code a second supplier prints on what is otherwise the same carton.
     * `product_units.barcode` holds one.
     *
     * The shop had exactly one place to put the others — the product's "other
     * barcodes" — and every code there means ONE PIECE. So the second code on
     * a carton, entered the only way the form allowed, rang a single at the
     * single's price: a carton of biscuits out of the door for Rs 50.
     *
     * A row in `product_barcodes` may now say which pack it is on. Null, as
     * before, is the piece (or, with `variant_id`, one size of it).
     *
     * Cascades: a pack that is really gone takes its codes with it. Packs are
     * soft-deleted when removed from an item, which no foreign key sees — the
     * action that removes one deletes its codes itself.
     */
    public function up(): void
    {
        Schema::table('product_barcodes', function (Blueprint $table): void {
            $table->foreignUuid('product_unit_id')->nullable()->after('variant_id')
                ->constrained('product_units')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('product_barcodes', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('product_unit_id');
        });
    }
};
