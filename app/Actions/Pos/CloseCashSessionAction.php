<?php

namespace App\Actions\Pos;

use App\Enums\SaleStatus;
use App\Exceptions\DomainException;
use App\Models\CashSession;
use App\Models\Sale;
use App\Models\SalePayment;
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
            $completed = Sale::query()
                ->where('cash_session_id', $session->id)
                ->where('status', SaleStatus::Completed);

            // Cash actually in the drawer = cash TENDERED (from the per-tender
            // breakdown, so a split sale's cash slice counts) − change handed
            // back (change is paid out of the till). A card/wallet tender never
            // touches cash. This is the reconciliation-correct figure.
            $completedIds = (clone $completed)->pluck('id');
            $cashTendered = (float) SalePayment::query()
                ->whereIn('sale_id', $completedIds)
                ->where('method', 'cash')
                ->sum('amount');
            $changeGiven = (float) (clone $completed)->sum('change_due');
            $cashSales = round($cashTendered - $changeGiven, 2);
            $salesTotal = (float) (clone $completed)->sum('total');
            $salesCount = (clone $completed)->count();

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
