<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * HOW FAR BACK A SHOP CAN LOOK — stated, because it was not.
 *
 * Plans sell a retention window: two years of history on the cheap one, five
 * on the next. Nothing in this schema knew that. The word "retention" appears
 * nowhere in `app/` except on a rider application, so the promise lived
 * entirely in whatever a salesperson said on the phone.
 *
 * ── Why this column and nothing else, today ─────────────────────────────
 *
 * ARCHIVE IS NOT DELETE. That is the rule the whole idea rests on, and it is
 * also why the enforcement half is not being written on a hunch: hiding a
 * shop's own history is irreversible from where the shopkeeper sits, even
 * when the rows are still there. A shop that opens Sales and cannot find
 * last March does not think "my plan covers two years" — it thinks its
 * records have been lost, and it rings in a panic.
 *
 * So this records the POLICY and makes it visible on both sides: the plan
 * catalogue says what each tier gives, and the shop's own Subscription page
 * says what it has. Whether a read is then fenced — and whether that is a
 * hard fence or simply where the date filter starts — is a product decision
 * with a customer-support cost attached, and it is recorded in HANDOVER.md
 * as the open half rather than guessed at here.
 *
 * NULL means no limit, and it is the default for every existing plan: no
 * shop's window narrows because this column appeared.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('plans', function (Blueprint $table): void {
            // MONTHS, not years. "Eighteen months" is a real offer and a
            // years column could not hold it; 24 and 60 are the ordinary
            // two and five.
            $table->unsignedSmallInteger('retention_months')->nullable()->after('max_orders_month');
        });
    }

    public function down(): void
    {
        Schema::table('plans', function (Blueprint $table): void {
            $table->dropColumn('retention_months');
        });
    }
};
