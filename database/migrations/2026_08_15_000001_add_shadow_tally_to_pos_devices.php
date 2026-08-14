<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * How many carts each till has actually shadow-checked — the DENOMINATOR.
 *
 * ── Why an empty variance table is not, on its own, evidence ─────────────
 *
 * Offline selling is allowed once shadow mode has run over real trading and
 * found nothing. But "found nothing" is produced identically by two very
 * different worlds:
 *
 *   the engine agreed on 1,284 real carts        ← what we are hoping for
 *   the engine never ran once                    ← a till that never pulled
 *                                                  its catalog, so every check
 *                                                  skipped, silently
 *
 * Reading zero and shipping is only safe in the first. Without a count of
 * checks there is no way to tell them apart, and the more dangerous world is
 * also the quieter one — nothing to see is exactly what it looks like.
 *
 * So a till reports what it did, not only what it found: how many carts it
 * checked, how many matched, how many it had to skip.
 *
 * ── Why the totals are stored as sent, and not accumulated ───────────────
 *
 * A device sends its own running totals and the server stores them as they
 * arrive. Two consequences, both chosen:
 *
 *   • A re-sent boot is a no-op. Storing an absolute is idempotent where
 *     incrementing would inflate the very number the decision turns on.
 *   • A till whose local storage is wiped restarts at zero, and the shop's
 *     evidence drops with it.
 *
 * The second looks like a flaw and is the safer half of the trade. This number
 * exists to authorise a risky change, so it must fail by UNDER-claiming: a drop
 * delays offline selling, where a carried-forward total would authorise it on
 * evidence gathered by a catalog and an engine that no longer exist. `since`
 * is what makes a drop legible rather than mysterious — it says how far back
 * the evidence on offer actually reaches.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pos_devices', function (Blueprint $table): void {
            // Carts this till priced a second time with the offline engine.
            $table->unsignedInteger('shadow_checked')->default(0);
            // ... of which the two engines agreed to the paisa.
            $table->unsignedInteger('shadow_matched')->default(0);
            // ... and which it could not price at all, usually because an item
            // was not in its local catalog yet. A skip is not agreement, and
            // counting it as one would be the flattering lie.
            $table->unsignedInteger('shadow_skipped')->default(0);
            // ... and which disagreed. Held here as well as in
            // pricing_variances because that table is pruned on the device at
            // 200 rows, so its size stops being a count once a till is busy.
            $table->unsignedInteger('shadow_differed')->default(0);
            // When this till started counting. Reset whenever local storage is
            // wiped, which is what makes a total dropping readable.
            $table->timestamp('shadow_since')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('pos_devices', function (Blueprint $table): void {
            $table->dropColumn([
                'shadow_checked',
                'shadow_matched',
                'shadow_skipped',
                'shadow_differed',
                'shadow_since',
            ]);
        });
    }
};
