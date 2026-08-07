<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Somebody else stood at the till for ten minutes.
 *
 * A shift is CASHIER × LANE, and until now that was the only relationship the
 * till understood. So when a cashier went for prayer, lunch or the bathroom,
 * the shop had three options and all three were wrong:
 *
 *   - stop the lane, and lose ten minutes of a queue;
 *   - count the drawer out and open a fresh shift for a ten-minute absence,
 *     which turns a break into a reconciliation;
 *   - let the reliever ring under the absent cashier's login, which is the one
 *     the counter actually picks — and it makes every stamp on those sales a
 *     lie, right at the moment the shop most needs them to be true.
 *
 * A cover is the fourth answer: the reliever rings sales into the drawer they
 * are standing at, under their OWN name, and the drawer stays the responsibility
 * of the cashier who will count it.
 *
 * That split is the whole design. Cover grants the right to SELL, not the right
 * to RECONCILE — a reliever never sees the expected cash and never counts the
 * box. If it granted both it would just be a handover with extra steps, and the
 * shop would be back to two people accountable for one drawer.
 *
 * Figures are frozen when the cover ends, for the same reason a Z-read is: the
 * question "what did Bilal take while covering Ayesha" is asked when the drawer
 * is short, and an answer that quietly changes as sales are later voided is not
 * evidence of anything. While a cover is still running there is nothing to
 * freeze, so it is computed live — the same rule the day view already follows
 * for open shifts.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cash_session_covers', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            // The drawer being covered. Cascades: a cover has no meaning apart
            // from the shift it happened inside.
            $table->foreignUuid('cash_session_id')->constrained()->cascadeOnDelete();
            // Who stepped in.
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();

            $table->timestamp('started_at');
            // null = still covering. That IS the open state, so there is no
            // status column that can disagree with the end time beside it.
            $table->timestamp('ended_at')->nullable();
            $table->foreignUuid('ended_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('reason', 191)->nullable();

            // Frozen at hand-back. Zero until then, and never read while the
            // cover is open — the live figure is computed instead.
            $table->unsignedInteger('sales_count')->default(0);
            $table->decimal('sales_total', 12, 2)->default(0);
            $table->decimal('cash_taken', 12, 2)->default(0);

            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            // "Is this lane being covered right now?" — asked on every sale a
            // reliever rings, so it has to be an index hit.
            $table->index(['cash_session_id', 'ended_at']);
            $table->index(['tenant_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cash_session_covers');
    }
};
