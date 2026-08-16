<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Whose nozzle it was.
 *
 * ── A figure computed perfectly and owed by nobody ──────────────────────
 *
 * The forecourt close already produces the number that matters most at a petrol
 * pump: `unbilled_litres` — fuel that crossed a meter and was never rung up. It
 * is computed per nozzle, from meters against the till, with test litres taken
 * out of both sides. The arithmetic is not the problem.
 *
 * The problem is that it lands on the SHIFT. An owner reads "forty litres
 * unbilled" and cannot say by whom, because nothing on a reading names a
 * person. `opened_by` and `closed_by` are the manager who ran the shift, not
 * the four men who worked the nozzles.
 *
 * At a Pakistani pump the attendant is the control. Each works assigned nozzles
 * and hands over cash for their litres at the end of the shift; the unbilled
 * figure IS somebody's shortfall, and it is chased that evening or not at all.
 * A station-wide total is a number an owner can worry about and cannot act on.
 *
 * ── Why it goes on the READING and not the shift ────────────────────────
 *
 * Because that is where the litres are. One shift has several nozzles and
 * several attendants, and two of them can be short on the same night for
 * unrelated reasons. Putting a single attendant on the shift would answer a
 * question nobody asked.
 *
 * ── Nullable, and it stays nullable ─────────────────────────────────────
 *
 * A one-man pump has no assignment to make, and a station that has never used
 * this must not find its shifts refusing to open on the next deploy. Unassigned
 * readings roll up as "unassigned" rather than vanishing — a shortfall nobody
 * is named for is still a shortfall, and hiding it would be worse than not
 * having the column.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('forecourt_readings', function (Blueprint $table): void {
            // The person on this nozzle for this shift. nullOnDelete rather
            // than cascade: a reading is a measurement that happened, and an
            // attendant leaving the shop must not erase the night they were
            // short.
            $table->foreignUuid('attendant_id')->nullable()
                ->constrained('users')->nullOnDelete();

            // "What did Ali owe across last month's shifts" — the query this
            // whole column exists to make answerable.
            $table->index(['tenant_id', 'attendant_id']);
        });
    }

    public function down(): void
    {
        Schema::table('forecourt_readings', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'attendant_id']);
            $table->dropConstrainedForeignId('attendant_id');
        });
    }
};
