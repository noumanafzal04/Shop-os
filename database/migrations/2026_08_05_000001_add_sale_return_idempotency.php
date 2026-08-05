<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Returns were the one money-moving endpoint without a replay guard. A retried
 * or double-clicked PARTIAL return passed the over-return check twice (it reads
 * PRIOR returns, and 3-of-10 is still within 10), so the shop refunded real cash
 * twice AND restocked twice — the restock keys are derived from the new return's
 * id, so they didn't collapse either.
 *
 * Same shape as sales/orders: a caller-supplied key, unique per tenant, so a
 * concurrent duplicate loses on the constraint and replays the original.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sale_returns', function (Blueprint $table): void {
            $table->string('idempotency_key', 64)->nullable()->after('return_number');
            $table->unique(['tenant_id', 'idempotency_key']);
        });
    }

    public function down(): void
    {
        Schema::table('sale_returns', function (Blueprint $table): void {
            $table->dropUnique(['tenant_id', 'idempotency_key']);
            $table->dropColumn('idempotency_key');
        });
    }
};
