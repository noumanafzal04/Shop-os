<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What a shift carries when it was opened with no server.
 *
 * ── Why a shift may be opened offline at all ────────────────────────────
 *
 * The offline till was built so a shop can trade through an outage, and then
 * put the whole capability behind a gate that needed the server: no shift, no
 * tender. That is fine until the line is already down when the shop opens — the
 * morning the feature exists for — and it cannot start a shift at all.
 *
 * So the till mints the session id itself, the same answer the offline receipt
 * number reached for the same reason. A uuid does not collide, and the sales
 * queued behind it already name it, so nothing has to be rewritten on arrival.
 *
 * ── Why a broken invariant is RECORDED and not refused ──────────────────
 *
 * Opening a shift has real rules: one open shift per lane, one per cashier. A
 * shift opened offline can break them — lane 3 was already held by somebody
 * who came back online first, or the same cashier has a shift open elsewhere.
 *
 * The money still went into a physical drawer. Refusing the shift on arrival
 * would destroy the record of something that already happened, and orphan every
 * sale rung into it. So it is accepted, and the conflict is written down for the
 * owner to reconcile — the same rule sales already follow, for the same reason.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cash_sessions', function (Blueprint $table): void {
            // WHICH tablet opened it. The queue lives on the device, so "whose
            // shift arrived late" is a device question, not a lane one.
            $table->foreignUuid('pos_device_id')->nullable()
                ->constrained('pos_devices')->nullOnDelete();
            // When it reached us, as against when it was opened (`opened_at`).
            // Null on every shift opened online, which is almost all of them.
            $table->timestamp('synced_at')->nullable();
            // Rules this shift broke by existing. Flagged, never corrected —
            // "fixing" it by refusing would leave a counted drawer with no
            // shift to belong to.
            $table->json('offline_violations')->nullable();

            $table->index(['tenant_id', 'synced_at']);
        });
    }

    public function down(): void
    {
        Schema::table('cash_sessions', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'synced_at']);
            $table->dropConstrainedForeignId('pos_device_id');
            $table->dropColumn(['synced_at', 'offline_violations']);
        });
    }
};
