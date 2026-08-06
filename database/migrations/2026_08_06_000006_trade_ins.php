<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The old battery on the counter.
 *
 * A customer buys a Rs 24,500 battery, hands over their dead one, and pays
 * Rs 21,500. Until now the only way to record that was a Rs 3,000 discount,
 * and a discount is the wrong shape in two directions at once:
 *
 *  - Revenue is understated. The battery sold for 24,500; the shop did not
 *    reduce its price, it accepted 3,000 of the payment in goods. Margin
 *    reports read as though the counter had been giving money away.
 *  - The scrap vanishes. The shop is now holding a dead battery worth real
 *    money — a scrap dealer pays for it by the kilo — and nothing anywhere
 *    says so. It is bought, stored, and sold with no record on either end,
 *    which is exactly the gap a batch of them walks out through.
 *
 * A trade-in is a TENDER, not a discount: part of the bill settled in goods
 * instead of rupees. So the sale keeps its full total, a `trade_in` payment row
 * carries the allowance, and the scrap enters stock like any other receipt.
 *
 * `sale_returns.refund_trade_in` is the same idea the khata already uses with
 * `refund_credit`: when the sale comes back, the till must pay out only the
 * rupees it actually took. Handing over 24,500 in cash for a battery the
 * customer part-paid for with scrap turns the counter into a way to convert
 * dead batteries into money.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sale_trade_ins', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('sale_id')->constrained('sales')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            // What came in. Nullable + snapshot name, like sale_items: deleting
            // the scrap SKU later must never corrupt what a past sale recorded.
            $table->foreignUuid('product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->string('product_name');
            // What it actually was — "Osaka 70Ah, about 2 years old". The scrap
            // SKU is a bucket; this is the row that lets someone answer "which
            // one did we take in on Tuesday?".
            $table->string('description')->nullable();

            $table->decimal('quantity', 12, 3)->default(1);
            $table->decimal('unit_allowance', 12, 2);
            $table->decimal('total_allowance', 12, 2);
            $table->text('notes')->nullable();

            // Set when the scrap went back out — a voided sale, or a return
            // where the customer took their old unit home again.
            $table->timestamp('reversed_at')->nullable();

            $table->timestamps();

            $table->index(['tenant_id', 'sale_id']);
            $table->index(['tenant_id', 'product_id']);
        });

        Schema::table('sales', function (Blueprint $table): void {
            // Denormalised so a receipt, a report or a margin calculation can
            // separate "settled in goods" from "settled in rupees" without
            // joining the tender rows every time.
            $table->decimal('trade_in_total', 12, 2)->default(0)->after('amount_paid');
        });

        Schema::table('sale_returns', function (Blueprint $table): void {
            // The slice of a refund that is NOT paid out in cash, because it
            // never arrived as cash. Mirrors refund_credit.
            $table->decimal('refund_trade_in', 12, 2)->default(0)->after('refund_credit');
        });
    }

    public function down(): void
    {
        Schema::table('sale_returns', fn (Blueprint $t) => $t->dropColumn('refund_trade_in'));
        Schema::table('sales', fn (Blueprint $t) => $t->dropColumn('trade_in_total'));
        Schema::dropIfExists('sale_trade_ins');
    }
};
