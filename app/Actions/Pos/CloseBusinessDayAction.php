<?php

namespace App\Actions\Pos;

use App\Exceptions\DomainException;
use App\Models\BankDeposit;
use App\Models\BusinessDay;
use App\Models\CashSession;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Open and close a shop's trading day.
 *
 * A day is the unit an owner thinks in and the one nothing else could answer:
 * a shift belongs to one cashier, and "what did the shop take today" spans
 * three of them plus whatever went to the bank.
 *
 * Two rules that make the roll-up trustworthy:
 *
 *  - a day cannot close over an OPEN shift. Its totals are summed from the
 *    shifts' frozen close figures, and a shift still running has none — the
 *    day would silently under-report by a whole drawer, which is exactly the
 *    drawer somebody is still selling from.
 *
 *  - the figures are written once and never recomputed. A day signed off in
 *    March reads the same in September, whatever has happened to a linked sale
 *    since. This is the same rule the shift itself follows, for the same
 *    reason: a variance somebody accepted must not quietly change.
 */
class CloseBusinessDayAction
{
    public function open(User $user, ?string $branchId, ?string $date = null): BusinessDay
    {
        return DB::transaction(function () use ($user, $branchId, $date): BusinessDay {
            $tradingDate = $date ?? $user->tenant?->localNow()->toDateString() ?? now()->toDateString();

            $existing = BusinessDay::query()
                ->where('branch_id', $branchId)
                ->whereDate('trading_date', $tradingDate)
                ->lockForUpdate()
                ->first();

            if ($existing !== null) {
                if ($existing->isOpen()) {
                    return $existing;   // Re-opening today is a no-op, not an error.
                }

                throw DomainException::conflict(
                    "Trading on {$tradingDate} has already been closed off.",
                    'BUSINESS_DAY_CLOSED',
                );
            }

            return BusinessDay::query()->create([
                'branch_id' => $branchId,
                'trading_date' => $tradingDate,
                'status' => BusinessDay::STATUS_OPEN,
                'opened_by' => $user->id,
                'opened_at' => now(),
            ]);
        });
    }

    public function close(User $user, BusinessDay $day, ?string $notes = null): BusinessDay
    {
        return DB::transaction(function () use ($user, $day, $notes): BusinessDay {
            /** @var BusinessDay $locked */
            $locked = BusinessDay::query()->whereKey($day->id)->lockForUpdate()->firstOrFail();

            if (! $locked->isOpen()) {
                throw DomainException::conflict('This day is already closed.', 'BUSINESS_DAY_CLOSED');
            }

            $sessions = CashSession::query()
                ->where('business_day_id', $locked->id)
                ->get();

            $stillOpen = $sessions->where('status', 'open');

            if ($stillOpen->isNotEmpty()) {
                throw DomainException::conflict(
                    $stillOpen->count() === 1
                        ? 'A shift is still open. Close it before closing off the day — its drawer has no counted figure yet.'
                        : "{$stillOpen->count()} shifts are still open. Close them before closing off the day.",
                    'SHIFTS_STILL_OPEN',
                );
            }

            $banked = round((float) BankDeposit::query()
                ->where('business_day_id', $locked->id)
                ->sum('amount'), 2);

            // One combined tender picture for the day: three cashiers' card
            // totals are one card total to the person reconciling the terminal.
            $tenderMix = [];
            foreach ($sessions as $session) {
                foreach (($session->declared_tenders ?? []) as $method => $amount) {
                    $tenderMix[$method] = round(($tenderMix[$method] ?? 0) + (float) $amount, 2);
                }
            }

            $locked->update([
                'status' => BusinessDay::STATUS_CLOSED,
                'closed_by' => $user->id,
                'closed_at' => now(),
                'shifts_count' => $sessions->count(),
                'opening_float' => round((float) $sessions->sum(fn ($s) => (float) $s->opening_float), 2),
                'cash_sales' => round((float) $sessions->sum(fn ($s) => (float) $s->cash_sales), 2),
                'cash_in' => round((float) $sessions->sum(fn ($s) => (float) $s->cash_in), 2),
                'cash_out' => round((float) $sessions->sum(fn ($s) => (float) $s->cash_out), 2),
                'expected_cash' => round((float) $sessions->sum(fn ($s) => (float) $s->expected_cash), 2),
                'counted_cash' => round((float) $sessions->sum(fn ($s) => (float) $s->counted_cash), 2),
                // Summed, not recomputed from the totals: a day where one lane
                // is 500 over and another 500 short nets to zero, and that is
                // two problems, not none. The per-shift rows keep both.
                'variance' => round((float) $sessions->sum(fn ($s) => (float) $s->variance), 2),
                'sales_count' => (int) $sessions->sum(fn ($s) => (int) $s->sales_count),
                'sales_total' => round((float) $sessions->sum(fn ($s) => (float) $s->sales_total), 2),
                'banked_amount' => $banked,
                'tender_mix' => $tenderMix ?: null,
                'notes' => $notes ?? $locked->notes,
            ]);

            return $locked->fresh(['branch', 'openedBy', 'closedBy']);
        });
    }
}
