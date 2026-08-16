<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Who SOLD it, as opposed to who rang it.
 *
 * ── A report that credits the wrong person ──────────────────────────────
 *
 * `ReportService::staffPerformance` groups completed sales by `created_by` and
 * the panel titles it "Staff performance". Those are two different claims. The
 * service's own docblock is honest — "grouped by the staff who rang them up" —
 * and the screen is not.
 *
 * In a one-person shop they are the same person and the report is right. On a
 * showroom floor they are not: three or four salesmen work the customers and
 * one cashier rings everything at the counter, so the report says the cashier
 * sold the entire month and the men who actually did it appear nowhere. That
 * is the same defect the forecourt had — a figure computed perfectly and owed
 * by nobody — and it is worse here, because a wrong name on a performance
 * report is read as a judgement about people.
 *
 * ── Why it cannot be inferred ───────────────────────────────────────────
 *
 * There is nothing in a sale that says who walked the customer round the shop.
 * Falling back to the cashier is precisely the lie the current report tells, so
 * an unattributed sale stays unattributed and is reported under nobody. Same
 * rule as the forecourt's unassigned nozzles: a figure no one is named for is
 * still a figure, and hiding it is worse than not asking.
 *
 * ── Nullable, and off by default ────────────────────────────────────────
 *
 * Most shops on this platform are one counter and one person. Asking them who
 * served each customer would add a control to every sale to answer a question
 * they never ask, and a POS that got slower would be the whole cost of a
 * feature they gain nothing from. The shop turns it on
 * (`pos_ask_who_served`), and until it does nothing changes anywhere.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sales', function (Blueprint $table): void {
            // nullOnDelete rather than cascade: a sale that happened is not
            // erased because the salesman left, and the takings must not move
            // when a staff record is removed.
            $table->foreignUuid('served_by')->nullable()->after('created_by')
                ->constrained('users')->nullOnDelete();

            // "What did Bilal sell this month" — the query the column exists
            // for, and the one the report runs.
            $table->index(['tenant_id', 'served_by']);
        });
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'served_by']);
            $table->dropConstrainedForeignId('served_by');
        });
    }
};
