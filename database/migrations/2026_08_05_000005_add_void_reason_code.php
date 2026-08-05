<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A coded reason on every void.
 *
 * `cancel_reason` was free text, which is unreviewable: a manager scanning a
 * week of voids cannot tell a mis-keyed item from a pattern, so the one control
 * that catches a ring-and-void — somebody reading the void report — had nothing
 * countable to read. The code makes voids tallyable per cashier; the free-text
 * note stays alongside for the detail.
 *
 * Nullable, because sales voided before this shipped have no code and inventing
 * one would misrepresent them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sales', function (Blueprint $table): void {
            $table->string('cancel_reason_code', 40)->nullable()->after('cancel_reason');
            // The void report: "voids by this cashier, this month".
            $table->index(['tenant_id', 'cancelled_by']);
        });
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'cancelled_by']);
            $table->dropColumn('cancel_reason_code');
        });
    }
};
