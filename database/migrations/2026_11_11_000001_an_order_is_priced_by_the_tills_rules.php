<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * AN ORDER IS PRICED BY THE TILL'S RULES.
 *
 * The till charged 5% tax on a biryani and took "Lunch −20%" and a member's
 * 10% off; the same biryani ordered online or on the phone was charged no
 * tax and took no offer but a coupon. The owner's word (2026-11-11): "market
 * standard" — one price whichever door the customer came in by.
 *
 * `discount` stays the WHOLE money off the goods (coupon + promotion +
 * member), as it always was for a sale; the two new shares say how much of
 * it each rule gave, so the coupon's own share is what is left. The tax is
 * the figure the customer was quoted, settled at placement and replayed at
 * completion; `tax_inclusive` the mode it was quoted in. Each line keeps the
 * rate it was taxed at, so a later return refunds exactly that.
 *
 * Orders placed before this carry 0 / false / null, which is exactly what
 * they were charged — completing one behaves as it always did.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->decimal('promotion_discount', 12, 2)->default(0)->after('discount');
            $table->decimal('member_discount', 12, 2)->default(0)->after('promotion_discount');
            // No foreign key: a promotion ended and deleted next month must
            // not take the record of what this order was given with it.
            $table->uuid('promotion_id')->nullable()->after('member_discount');
            $table->string('promotion_name')->nullable()->after('promotion_id');
            $table->decimal('tax', 12, 2)->default(0)->after('promotion_name');
            $table->boolean('tax_inclusive')->default(false)->after('tax');
        });

        Schema::table('order_items', function (Blueprint $table): void {
            $table->decimal('tax_rate', 5, 2)->nullable()->after('line_total');
        });
    }

    public function down(): void
    {
        Schema::table('order_items', function (Blueprint $table): void {
            $table->dropColumn('tax_rate');
        });

        Schema::table('orders', function (Blueprint $table): void {
            $table->dropColumn(['promotion_discount', 'member_discount', 'promotion_id', 'promotion_name', 'tax', 'tax_inclusive']);
        });
    }
};
