<?php

namespace App\Actions\Pos;

use App\Exceptions\DomainException;
use App\Models\CashSession;
use App\Support\DenominationCount;
use App\Support\DrawerMath;
use Illuminate\Support\Facades\DB;

/**
 * Closes a shift and reconciles the drawer.
 *
 * The arithmetic lives in DrawerMath, shared with the mid-shift X-read, so the
 * expectation a cashier sees at 4pm is the same one they're held to at 9pm.
 * Closing then FREEZES those figures on the row: a Z-report reprinted next year
 * shows what was counted that night, even if a linked record was edited since.
 *
 * Two things the count itself now carries:
 *
 *  DENOMINATIONS     when the drawer is counted by note and coin, the total is
 *                    DERIVED from that breakdown rather than typed alongside
 *                    it. A count and a total that disagree is a count nobody
 *                    did, and silently preferring one would hide exactly the
 *                    error the breakdown exists to catch.
 *
 *  DECLARED TENDERS  what the cashier says the card terminal took, against what
 *                    the POS thinks it rang. The moment to catch a mis-keyed
 *                    card sale is here, with the cashier still standing there —
 *                    not at month end against a bank statement.
 */
class CloseCashSessionAction
{
    /**
     * @param  array{
     *     denominations?: array<int|string, int|string>|null,
     *     declared_tenders?: array<string, float|int|string>|null,
     *     blind?: bool
     * }  $extra
     */
    public function execute(
        CashSession $session,
        float $countedCash,
        ?string $notes = null,
        ?string $closedBy = null,
        array $extra = [],
    ): CashSession {
        if (! $session->isOpen()) {
            throw DomainException::conflict('This shift is already closed.', 'SHIFT_NOT_OPEN');
        }

        return DB::transaction(function () use ($session, $countedCash, $notes, $closedBy, $extra): CashSession {
            $drawer = DrawerMath::for($session);

            $denominations = DenominationCount::clean($extra['denominations'] ?? null);
            // The breakdown wins where there is one. It is the only figure a
            // second person can verify against the drawer itself.
            $counted = $denominations !== null
                ? DenominationCount::total($denominations)
                : round($countedCash, 2);

            $declared = $this->cleanTenders($extra['declared_tenders'] ?? null);
            $tenderVariances = null;

            if ($declared !== null) {
                $expectedMix = $drawer['tender_mix'];
                $tenderVariances = [];

                // Every method appearing on EITHER side. A declared method the
                // POS never rang is the more interesting of the two: it means a
                // sale went through a terminal and not through here.
                foreach (array_unique([...array_keys($declared), ...array_keys($expectedMix)]) as $method) {
                    $tenderVariances[$method] = round(
                        ($declared[$method] ?? 0) - ($expectedMix[$method] ?? 0),
                        2,
                    );
                }
            }

            $session->forceFill([
                'status' => 'closed',
                'cash_sales' => $drawer['cash_sales'],
                'cash_in' => $drawer['cash_in'],
                'cash_out' => $drawer['cash_out'],
                'expected_cash' => $drawer['expected_cash'],
                'counted_cash' => $counted,
                'closing_denominations' => $denominations,
                'declared_tenders' => $declared,
                'tender_variances' => $tenderVariances,
                // Frozen, not read from settings at report time: turning blind
                // close off next month must not rewrite how last month's counts
                // were taken.
                'blind_close' => (bool) ($extra['blind'] ?? false),
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

    /**
     * @param  array<string, float|int|string>|null  $tenders
     * @return array<string, float>|null
     */
    private function cleanTenders(?array $tenders): ?array
    {
        if (empty($tenders)) {
            return null;
        }

        $out = [];

        foreach ($tenders as $method => $amount) {
            // Zero is meaningful here — "the card machine took nothing today"
            // is a declaration, not an omission.
            $out[(string) $method] = round((float) $amount, 2);
        }

        return $out === [] ? null : $out;
    }
}
