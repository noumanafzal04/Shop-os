<?php

namespace App\Support;

use App\Enums\SaleStatus;
use App\Models\CashMovement;
use App\Models\CashSession;
use App\Models\Sale;
use App\Models\SalePayment;
use App\Models\SaleReturn;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * The ONE place that computes what a drawer should hold.
 *
 * Both the mid-shift X-read and the close-and-count read from here. If they
 * each did their own arithmetic they would drift the first time a term changed,
 * and a cashier would be handed one expectation at 4pm and a different one at
 * 9pm — with the difference landing on them as a variance.
 *
 * The expectation:
 *
 *   expected = opening float
 *            + cash tendered            (per-tender, so a split sale's cash slice counts)
 *            − change handed back       (change is paid out of the till)
 *            − cash refunds             (only the cash slice; a khata-settled return moved no cash)
 *            + movements in             (paid-in, float top-up, khata received)
 *            − movements out            (pay-out, safe drop, supplier paid from till, voided cash)
 *
 * Two subtleties worth keeping:
 *
 *  - a REFUNDED sale's tender still counts. The refund is subtracted on its own
 *    line; dropping the whole tender would show a phantom shortage.
 *  - a CANCELLED sale's tender counts too, and the cash handed back is recorded
 *    as a `void_refund` movement. Excluding both legs (the old behaviour) gave
 *    the right total but made a ring-and-void theft invisible — and got the
 *    cross-shift case wrong, since yesterday's sale voided today takes cash out
 *    of TODAY's drawer.
 */
class DrawerMath
{
    /** Statuses whose tender physically entered this drawer. */
    public const RUNG_STATUSES = [
        SaleStatus::Completed,
        SaleStatus::PartiallyRefunded,
        SaleStatus::Refunded,
        SaleStatus::Cancelled,
    ];

    /**
     * @return array{
     *   cash_tendered: float, change_given: float, cash_refunds: float,
     *   cash_in: float, cash_out: float, cash_sales: float, expected_cash: float,
     *   sales_count: int, sales_total: float, discounts: float, tax: float,
     *   voids: int, refunds: int, tender_mix: array<string, float>
     * }
     */
    public static function for(CashSession $session): array
    {
        $rung = self::sales()
            ->where('cash_session_id', $session->id)
            ->whereIn('status', self::RUNG_STATUSES);

        $rungIds = (clone $rung)->pluck('id');

        $cashTendered = (float) SalePayment::withoutTenancy()
            ->whereIn('sale_id', $rungIds)
            ->where('method', 'cash')
            ->sum('amount');

        $changeGiven = (float) (clone $rung)->sum('change_due');

        // Only the cash slice of a refund leaves the till. A khata-settled
        // return reduced the customer's debt and moved no cash; a trade-in slice
        // was never cash either — it walked in as a dead battery and walks back
        // out as one. Paying either out in rupees would show as a shortage that
        // the cashier is then asked to explain. Keyed by session so a refund rung
        // on THIS drawer hits this shift even against an older sale.
        $cashRefunds = (float) SaleReturn::withoutTenancy()
            ->where('cash_session_id', $session->id)
            ->where('refund_method', 'cash')
            ->sum(DB::raw('refund_total - refund_credit - refund_trade_in'));

        $movements = CashMovement::withoutTenancy()
            ->where('cash_session_id', $session->id)
            ->get(['type', 'direction', 'amount']);

        $cashIn = round((float) $movements->where('direction', 'in')->sum('amount'), 2);
        $cashOut = round((float) $movements->where('direction', 'out')->sum('amount'), 2);

        // Sales figures exclude cancelled sales — a void is not a sale, even
        // though its cash passed through the drawer.
        $sold = self::sales()
            ->where('cash_session_id', $session->id)
            ->whereIn('status', [SaleStatus::Completed, SaleStatus::PartiallyRefunded, SaleStatus::Refunded]);

        $tenderMix = SalePayment::withoutTenancy()
            ->whereIn('sale_id', (clone $sold)->pluck('id'))
            ->selectRaw('method, SUM(amount) as total')
            ->groupBy('method')
            ->pluck('total', 'method')
            ->map(fn ($v) => round((float) $v, 2))
            ->all();

        // Tips are already inside cash_tendered (they arrived with the payment)
        // and are deliberately NOT subtracted — the money is in the drawer, so
        // the count must expect it. Surfaced on its own line because the shop
        // pays it back out to staff and needs to know how much of the till is
        // theirs rather than the shop's.
        $tips = round((float) (clone $rung)->sum('tip_amount'), 2);

        $cashSales = round($cashTendered - $changeGiven - $cashRefunds, 2);
        $expected = round((float) $session->opening_float + $cashSales + $cashIn - $cashOut, 2);

        return [
            'cash_tendered' => round($cashTendered, 2),
            'change_given' => round($changeGiven, 2),
            'cash_refunds' => round($cashRefunds, 2),
            'cash_in' => $cashIn,
            'cash_out' => $cashOut,
            'tips' => $tips,
            'cash_sales' => $cashSales,
            'expected_cash' => $expected,
            'sales_count' => (int) (clone $sold)->count(),
            'sales_total' => round((float) (clone $sold)->sum('total'), 2),
            'discounts' => round((float) (clone $sold)->sum('discount'), 2),
            'tax' => round((float) (clone $sold)->sum('tax'), 2),
            'voids' => (int) self::sales()
                ->where('cash_session_id', $session->id)
                ->where('status', SaleStatus::Cancelled)->count(),
            'refunds' => (int) SaleReturn::withoutTenancy()
                ->where('cash_session_id', $session->id)->count(),
            'tender_mix' => $tenderMix,
        ];
    }

    /**
     * Every sale rung on a drawer, practice included.
     *
     * This is the one place that must see training sales, and the one place
     * where doing so is safe by construction: every query below is keyed by
     * `cash_session_id`, and a sale inherits `is_training` from the shift it was
     * rung on — so a live drawer can never pick up a practice sale, or the
     * reverse. Leaving the scope on instead would show a trainee an expected
     * cash of exactly their opening float while the drawer filled with notes,
     * which teaches the wrong lesson at the only moment that lesson lands.
     */
    private static function sales(): Builder
    {
        return Sale::withoutTenancy()->withoutGlobalScope('not_training');
    }
}
