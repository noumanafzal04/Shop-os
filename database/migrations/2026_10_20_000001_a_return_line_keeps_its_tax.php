<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * B6 of the full re-test (2026-10-18): two 1-of-2 returns of a line taxed
 * 31.45 each struck 15.72, and the paisa left over was never handed back. The
 * tax is now allocated cumulatively, as the value already was — and that needs
 * what each earlier return of the line actually struck.
 *
 * Additive: nullable. A return line from before it is read by the rule that
 * struck it (its own value × the rate).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sale_return_items', function (Blueprint $table) {
            $table->decimal('line_tax', 12, 2)->nullable()->after('line_total');
        });
    }

    public function down(): void
    {
        Schema::table('sale_return_items', function (Blueprint $table) {
            $table->dropColumn('line_tax');
        });
    }
};
