<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The slip a takeaway counter sends to its kitchen.
 *
 * ── What was missing ────────────────────────────────────────────────────
 *
 * A kitchen ticket could only ever be created by a dine-in tab's Fire. So a
 * café that rings a takeaway order at the TILL — the ordinary case, and what a
 * small café does all day — printed a receipt for the customer and told the
 * kitchen nothing. The only way to get a slip to the pass was to run every
 * order as a tab on a table that does not exist.
 *
 * Splitting `kitchen` out of `dine_in` made that visible rather than causing it:
 * a shop can now have the pass without the floor, and a pass nothing reaches is
 * a screen with nothing on it.
 *
 * ── Why a counter order is still a TICKET ───────────────────────────────
 *
 * Because everything the kitchen does is already built on one: the board reads
 * KOTs through their ticket, the bump lifecycle stamps the ticket's items, the
 * KOT print renders from it, and `forAnOpenTab` is what stops a docket
 * outliving the order it belongs to. A second, parallel shape for "food a till
 * sold" would need every one of those written again — and the two would
 * disagree the first time either changed.
 *
 * ── Why this is a new column and not the `sale_id` already there ────────
 *
 * `restaurant_tickets.sale_id` already exists and already means something
 * precise: the tab was SETTLED as a single sale. A counter order is settled by
 * exactly one sale too, so it fills that column honestly — but "settled by one
 * sale" and "was never a tab in the first place" are two different facts, and
 * putting both in one column is how a screen ends up asking one question and
 * being answered the other.
 *
 * The floor needs the second fact: a counter order is the KITCHEN's work, paid
 * before the kitchen ever saw it, and must not appear as a tab somebody can add
 * to or settle. Filtering the floor on `sale_id` instead would have hidden every
 * SETTLED tab from the closed-tabs view as well, which is a different screen and
 * a different question.
 *
 * It also decides when the ticket may close. A tab closes when it is settled; a
 * counter order has no settlement left to make, so it closes when the kitchen
 * has served the last docket on it — and it must stay OPEN until then, or
 * `forAnOpenTab` would drop the docket the moment it was fired.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('restaurant_tickets', function (Blueprint $table): void {
            // False on every tab a waiter opens, which is almost all of them.
            $table->boolean('from_counter')->default(false)->after('sale_id');
            // The floor asks "what is open and not a counter order" on every
            // load, per site.
            $table->index(['tenant_id', 'status', 'from_counter']);
        });
    }

    public function down(): void
    {
        Schema::table('restaurant_tickets', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'status', 'from_counter']);
            $table->dropColumn('from_counter');
        });
    }
};
