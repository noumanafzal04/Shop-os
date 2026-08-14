<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A sale that arrived after its own trading day had been signed off.
 *
 * ── The shop this is for ────────────────────────────────────────────────
 *
 * Tuesday's power came back at nine on Wednesday. The owner had already
 * counted Tuesday's drawers, closed the day, and taken the cash to the bank.
 * On Wednesday morning forty sales land, dated Tuesday, worth Rs 40,000.
 *
 * Nothing in the books moves. It must not: a business day's figures are summed
 * from the shifts' frozen close figures and written once — "a day signed off in
 * March reads the same in September". Quietly recomputing it would change a
 * variance somebody had already accepted and signed for.
 *
 * So Tuesday's takings, as the shop recorded them, are now Rs 40,000 short of
 * Tuesday's sales — and without this column nobody is ever told. The owner
 * finds it at audit, or never.
 *
 * ── Why it is stored on arrival and not worked out later ────────────────
 *
 * "Was the day closed when this landed" is a fact about a moment. Deriving it
 * at report time would give a different answer depending on when you looked:
 * a sale that arrived while the day was still open would start being flagged
 * the evening somebody closed that day, which is backwards — that sale was in
 * the totals.
 *
 * Recorded once, at sync, against the day as it stood then.
 *
 * ── It is not a violation ───────────────────────────────────────────────
 *
 * `offline_violations` is for things the till was not allowed to do. This is
 * nobody's fault — the till was offline and the owner was right to close the
 * day — and it needs a different action: an adjustment, not a decision about a
 * rule. Mixing the two would bury one in the other.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sales', function (Blueprint $table): void {
            $table->boolean('after_day_close')->default(false);
        });
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table): void {
            $table->dropColumn('after_day_close');
        });
    }
};
