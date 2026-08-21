<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A schedule-controlled drug is prescription-only. Always.
 *
 * `drug_schedule` and `requires_prescription` were two free-standing fields on
 * the same form with nothing tying them together, so a medicine could carry a
 * schedule with the prescription flag left off — and the two fences built on
 * those fields then disagreed about the same product:
 *
 *   the till   refused it (PRESCRIPTION_REQUIRED, read off `drug_schedule`)
 *   an order   took it    (OrderService only ever read `requires_prescription`)
 *
 * `Product::booted()` now guarantees the pairing on every write. This backfills
 * the rows written before it existed: without it a shop's existing catalogue
 * keeps the old, split state until somebody happens to re-save each item, and
 * the fence that was just added would go on letting those particular products
 * through.
 *
 * Deliberately NOT reversible. Down would have to guess which of these rows had
 * the flag off ON PURPOSE, and the answer is none of them — a controlled drug
 * that does not need a prescription is not a thing.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('products')
            ->whereNotNull('drug_schedule')
            ->where('drug_schedule', '!=', '')
            ->where(function ($q): void {
                $q->where('requires_prescription', false)
                    ->orWhereNull('requires_prescription');
            })
            ->update(['requires_prescription' => true]);
    }

    public function down(): void
    {
        // Nothing. See the note above.
    }
};
