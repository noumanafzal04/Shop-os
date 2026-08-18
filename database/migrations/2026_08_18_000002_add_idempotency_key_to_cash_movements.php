<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * So a drawer movement that arrives twice is recorded once.
 *
 * A shift opened offline is idempotent by nature — the till mints the session
 * id, so a replayed open finds the session already there. A close is idempotent
 * too: the shift is already closed and the counted figure is already on it.
 *
 * A movement has neither. Two `paid_out` rows of PKR 500 on one shift are a
 * perfectly ordinary thing for a shop to do, so the server cannot tell a
 * duplicate from a real second payout by looking at it. Without a key, one lost
 * acknowledgement takes PKR 500 out of the drawer twice and the cashier is
 * short at close with nothing to point at.
 *
 * Nullable, because every movement made at the counter with a server has no
 * queue behind it and needs no key.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cash_movements', function (Blueprint $table): void {
            $table->string('idempotency_key', 64)->nullable();
            $table->unique(['tenant_id', 'idempotency_key'], 'cash_movements_tenant_idem_unique');
        });
    }

    public function down(): void
    {
        Schema::table('cash_movements', function (Blueprint $table): void {
            $table->dropUnique('cash_movements_tenant_idem_unique');
            $table->dropColumn('idempotency_key');
        });
    }
};
