<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What a sale carries when it was rung with no server.
 *
 * ── Why the provisional number is KEPT after the real one is assigned ────
 *
 * An offline till never mints a number in the server's sequence — two tablets
 * would mint the same one. It prints `OFF-{register}-{device}-{seq}` instead,
 * and the customer walks out with that slip in the bag.
 *
 * On sync the server assigns the real invoice number, and it would be tidier to
 * drop the provisional one. It would also mean the piece of paper in the
 * customer's hand names a sale nobody can find. So BOTH are stored, and both
 * are searchable: the slip is the only reference that customer has.
 *
 * ── Why `sold_at` and `synced_at` are different columns ─────────────────
 *
 * They answer different questions and one cannot stand in for the other. A sale
 * rung on Tuesday and synced on Friday belongs to Tuesday's takings, Tuesday's
 * business day and Tuesday's cashier — but "how long was this shop out of
 * contact" is Friday minus Tuesday, and folding them loses that entirely.
 *
 * ── Why `beyond_offline_window` is recorded rather than refused ──────────
 *
 * The shop's allowed window had passed when this was rung. The money still
 * crossed the counter, so refusing the sale on arrival would be destroying a
 * record of something that already happened. It is accepted, and marked, and it
 * is the owner's to look at.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sales', function (Blueprint $table): void {
            // OFF-{register}-{device}-{seq}. What the customer's slip says.
            $table->string('offline_number', 64)->nullable();
            // WHICH tablet rang it — not which lane. The outbox lives on the
            // device, so "whose unsent sales were these" is a device question.
            $table->foreignUuid('pos_device_id')->nullable()
                ->constrained('pos_devices')->nullOnDelete();
            // When it reached us, as against when it happened (`sold_at`).
            $table->timestamp('synced_at')->nullable();
            // Rung after the shop's offline days had run out. Recorded, never
            // refused — the sale already happened.
            $table->boolean('beyond_offline_window')->default(false);
            // Things offline was not allowed to do, that this sale did anyway.
            //
            // FLAGGED rather than corrected, and that is the whole design. The
            // server's job on sync is to record what happened and report what
            // differs — not to approve. "Fixing" a credit sale into a cash one
            // would leave the shop believing it had been paid, which is worse
            // than any refusal. The owner reviews these; nothing is rewritten.
            $table->json('offline_violations')->nullable();

            // A device's own sequence, so the same slip cannot be filed twice
            // even if `idempotency_key` were somehow reused across a wipe.
            $table->unique(['tenant_id', 'offline_number'], 'sales_tenant_offline_number_unique');
            // "Show me everything that came in late" — the owner's first
            // question after a day with no internet.
            $table->index(['tenant_id', 'synced_at']);
        });
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table): void {
            $table->dropUnique('sales_tenant_offline_number_unique');
            $table->dropIndex(['tenant_id', 'synced_at']);
            $table->dropConstrainedForeignId('pos_device_id');
            $table->dropColumn([
                'offline_number', 'synced_at', 'beyond_offline_window', 'offline_violations',
            ]);
        });
    }
};
