<?php

namespace App\Actions\Pos;

use App\Enums\SaleStatus;
use App\Exceptions\DomainException;
use App\Models\CashSession;
use App\Models\Sale;
use App\Models\SalePayment;
use App\Models\SaleReturn;
use Illuminate\Support\Facades\DB;

/**
 * Closes a shift and reconciles the drawer:
 *   expected = opening float + cash sales rung up on this session
 *   variance = counted - expected  (over/short)
 */
class CloseCashSessionAction
{
    public function execute(CashSession $session, float $countedCash, ?string $notes = null): CashSession
    {
        if (! $session->isOpen()) {
            throw DomainException::conflict('This shift is already closed.', 'SHIFT_NOT_OPEN');
        }

        return DB::transaction(function () use ($session, $countedCash, $notes): CashSession {
            // Every non-cancelled sale rung on this shift brought its cash in —
            // a later partial/full REFUND flips the sale's status but the cash
            // it tendered is still in the drawer (the refund is accounted for
            // separately below). Filtering to Completed only would drop a
            // refunded sale's whole tender and show a phantom shortage.
            $rung = Sale::query()
                ->where('cash_session_id', $session->id)
                ->whereIn('status', [
                    SaleStatus::Completed,
                    SaleStatus::PartiallyRefunded,
                    SaleStatus::Refunded,
                ]);

            // Cash actually in the drawer = cash TENDERED (from the per-tender
            // breakdown, so a split sale's cash slice counts) − change handed
            // back (change is paid out of the till). A card/wallet tender never
            // touches cash. This is the reconciliation-correct figure.
            $rungIds = (clone $rung)->pluck('id');
            $cashTendered = (float) SalePayment::query()
                ->whereIn('sale_id', $rungIds)
                ->where('method', 'cash')
                ->sum('amount');
            $changeGiven = (float) (clone $rung)->sum('change_due');

            // Cash paid OUT as refunds during this shift. Only the cash slice
            // leaves the till: a khata-settled return (refund_credit) reduced
            // the customer's debt, no cash moved — so subtract refund_total
            // minus refund_credit. Keyed by cash_session_id so a refund rung on
            // THIS drawer hits this shift even against a prior day's sale.
            $cashRefunds = (float) SaleReturn::query()
                ->where('cash_session_id', $session->id)
                ->where('refund_method', 'cash')
                ->sum(DB::raw('refund_total - refund_credit'));

            $cashSales = round($cashTendered - $changeGiven - $cashRefunds, 2);
            $salesTotal = (float) (clone $rung)->sum('total');
            $salesCount = (clone $rung)->count();

            $expected = round((float) $session->opening_float + $cashSales, 2);
            $counted = round($countedCash, 2);

            $session->forceFill([
                'status' => 'closed',
                'cash_sales' => round($cashSales, 2),
                'expected_cash' => $expected,
                'counted_cash' => $counted,
                'variance' => round($counted - $expected, 2),
                'sales_count' => $salesCount,
                'sales_total' => round($salesTotal, 2),
                'notes' => $notes,
                'closed_at' => now(),
            ])->save();

            return $session;
        });
    }
}
