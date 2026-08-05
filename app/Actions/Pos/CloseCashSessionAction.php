<?php

namespace App\Actions\Pos;

use App\Exceptions\DomainException;
use App\Models\CashSession;
use App\Support\DrawerMath;
use Illuminate\Support\Facades\DB;

/**
 * Closes a shift and reconciles the drawer.
 *
 * The arithmetic lives in DrawerMath, shared with the mid-shift X-read, so the
 * expectation a cashier sees at 4pm is the same one they're held to at 9pm.
 * Closing then FREEZES those figures on the row: a Z-report reprinted next year
 * shows what was counted that night, even if a linked record was edited since.
 */
class CloseCashSessionAction
{
    public function execute(CashSession $session, float $countedCash, ?string $notes = null, ?string $closedBy = null): CashSession
    {
        if (! $session->isOpen()) {
            throw DomainException::conflict('This shift is already closed.', 'SHIFT_NOT_OPEN');
        }

        return DB::transaction(function () use ($session, $countedCash, $notes, $closedBy): CashSession {
            $drawer = DrawerMath::for($session);
            $counted = round($countedCash, 2);

            $session->forceFill([
                'status' => 'closed',
                'cash_sales' => $drawer['cash_sales'],
                'cash_in' => $drawer['cash_in'],
                'cash_out' => $drawer['cash_out'],
                'expected_cash' => $drawer['expected_cash'],
                'counted_cash' => $counted,
                'variance' => round($counted - $drawer['expected_cash'], 2),
                'sales_count' => $drawer['sales_count'],
                'sales_total' => $drawer['sales_total'],
                'notes' => $notes,
                'closed_at' => now(),
                // Who ended it. A manager force-closing a lane the cashier
                // walked away from is a different event from the cashier
                // counting their own drawer, and the variance means something
                // different in each case.
                'closed_by' => $closedBy ?? $session->user_id,
            ])->save();

            return $session;
        });
    }
}
