<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * AN EXCHANGE IS NOT A REFUND AND A NEW SALE (B21).
 *
 * An exchange takes goods back and hands others over in one step, the value
 * of what came back paying for the replacement. The dashboard and the
 * cashbook counted it as both: a shirt swapped for a dearer one read as 2,000
 * refunded and 2,500 sold, where 500 came in and nothing went out.
 *
 * The part of the credit that paid for the replacement is kept on BOTH rows —
 * the return and the replacement sale — so every sum can take it off both
 * sides (`Takings`). The net never changes, and both halves fall on the same
 * day at the same place, so no closed day is rewritten.
 *
 * Exchanges made before this are found by the credit tender every one of them
 * carries: method `other`, "Exchange credit — return RET-…".
 */
return new class extends Migration
{
    private const MARK = 'Exchange credit — return ';

    public function up(): void
    {
        Schema::table('sales', function (Blueprint $table): void {
            $table->decimal('exchange_credit', 12, 2)->default(0)->after('total');
        });
        Schema::table('sale_returns', function (Blueprint $table): void {
            $table->decimal('exchange_credit', 12, 2)->default(0)->after('refund_total');
        });

        $this->backfill();
    }

    /** Exchanges made before the column, found by their credit tender. Public so it can be tested. */
    public function backfill(): void
    {
        DB::table('sale_payments')
            ->join('sales', 'sales.id', '=', 'sale_payments.sale_id')
            ->where('sale_payments.method', 'other')
            ->where('sale_payments.reference', 'like', self::MARK.'%')
            ->orderBy('sale_payments.id')
            ->select(['sale_payments.id', 'sale_payments.amount', 'sale_payments.reference', 'sales.id as sale_id', 'sales.tenant_id', 'sales.total'])
            ->chunk(500, function ($credits): void {
                foreach ($credits as $credit) {
                    $used = round(min((float) $credit->amount, (float) $credit->total), 2);
                    $number = trim(Str::after((string) $credit->reference, self::MARK));

                    DB::table('sales')->where('id', $credit->sale_id)->update(['exchange_credit' => $used]);
                    DB::table('sale_returns')->where('tenant_id', $credit->tenant_id)->where('return_number', $number)
                        ->update(['exchange_credit' => $used]);
                }
            });
    }

    public function down(): void
    {
        Schema::table('sale_returns', fn (Blueprint $table) => $table->dropColumn('exchange_credit'));
        Schema::table('sales', fn (Blueprint $table) => $table->dropColumn('exchange_credit'));
    }
};
