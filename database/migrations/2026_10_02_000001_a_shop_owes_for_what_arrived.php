<?php

use App\Enums\PurchaseStatus;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A SHOP OWES FOR WHAT ARRIVED, NOT FOR WHAT IT ASKED FOR.
 *
 * `Payable` drew one line — a draft is a shopping list, a placed order is a
 * bill — and that line is right. What it never answered is the OTHER half of
 * the same question: how much of a placed order is a bill when half of it is
 * still on the truck.
 *
 * Every reader took `purchase_orders.total`, which is what was ORDERED and
 * never moves. So:
 *
 *   an order placed and not yet delivered was billed in full
 *   an order delivered short was billed for the part that never came
 *
 * On one load-test shop that was Rs 45,591,478 of debt against goods the shop
 * had never received — on a true payable of Rs 57.6M, so the figure was nearly
 * double. And it is not only a wrong number on a card: `Payable::openOrdersFor`
 * treats any order with `amount_paid < total` as open, and
 * `RecordSupplierPaymentAction` allocates oldest-first into exactly those. A
 * shopkeeper paying down "what I owe" would hand a wholesaler money for stock
 * still in a van.
 *
 * In a Pakistani shop the delivery man hands over what he has, the shop counts
 * it, and the bill is for that. Short delivery, smaller bill. That is the rule
 * this column restores.
 *
 * ── Why a column and not a subquery ─────────────────────────────────────
 *
 * Five places ask this question: the supplier card, the dashboard payables
 * figure, the purchases report, the open-orders allocator and the payment
 * action. A subquery into `purchase_order_items` in each is five chances to
 * drift, and `openOrdersFor` compares it to `amount_paid` in SQL, where a
 * correlated sum is awkward and slow. One maintained column keeps all five
 * reading the same number.
 *
 * ── Why not just move `total` ───────────────────────────────────────────
 *
 * Because `total` is the ORDER, and a purchase order is a document a supplier
 * also holds a copy of. Quietly rewriting it to mean something else would make
 * the shop's paperwork disagree with the wholesaler's for no visible reason.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('purchase_orders', function (Blueprint $t): void {
            // What has actually been delivered, priced at the line's own cost.
            // Zero until something arrives — which is the point.
            $t->decimal('received_total', 14, 2)->default(0)->after('total');
        });

        // Backfill from the lines, which have carried `quantity_received` all
        // along. A cancelled order owes nothing whatever arrived against it.
        // No table alias in the UPDATE: MySQL takes one, SQLite does not, and
        // the suite runs on SQLite. A correlated subquery naming the table in
        // full works on both.
        DB::statement(<<<'SQL'
            UPDATE purchase_orders
            SET received_total = COALESCE((
                SELECT ROUND(SUM(i.quantity_received * i.unit_cost), 2)
                FROM purchase_order_items i
                WHERE i.purchase_order_id = purchase_orders.id
            ), 0)
        SQL);

        DB::table('purchase_orders')
            ->where('status', PurchaseStatus::Cancelled->value)
            ->update(['received_total' => 0]);
    }

    public function down(): void
    {
        Schema::table('purchase_orders', function (Blueprint $t): void {
            $t->dropColumn('received_total');
        });
    }
};
