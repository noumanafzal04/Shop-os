<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The Large ran out. The Small did not.
 *
 * Eighty-sixing was a decision about a PRODUCT, so a pizzeria that ran out of
 * large bases had one move available: take the whole pizza off. Small and
 * Medium went with it, all evening, on the busiest item on the menu.
 *
 * A size is what a customer orders and what a kitchen runs out of, so it is the
 * thing that has to be markable. The product-level flag stays exactly as it is —
 * "no pizza tonight" is still a sentence a shop needs to be able to say.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_variants', function (Blueprint $table) {
            $table->timestamp('sold_out_at')->nullable()->after('is_active');
            $table->foreignUuid('sold_out_by')->nullable()->after('sold_out_at')
                ->constrained('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('product_variants', function (Blueprint $table) {
            $table->dropConstrainedForeignId('sold_out_by');
            $table->dropColumn('sold_out_at');
        });
    }
};
