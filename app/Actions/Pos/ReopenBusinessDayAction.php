<?php

namespace App\Actions\Pos;

use App\Exceptions\DomainException;
use App\Models\AuditLog;
use App\Models\BusinessDay;
use App\Models\User;
use App\Support\ShopDay;
use Illuminate\Support\Facades\DB;

/**
 * OPEN TODAY'S DAY AGAIN — the way back from a close pressed by mistake.
 *
 * ── What it is for ───────────────────────────────────────────────────
 *
 * "Close off the day" at two in the afternoon, on the wrong screen. No shift
 * can open on a closed day, so a shop that requires a shift to sell had
 * stopped trading until tomorrow, and the only advice anybody could give was
 * to switch that requirement off — trading the rest of the day with no drawer
 * to count it into.
 *
 * ── What it will not do ──────────────────────────────────────────────
 *
 * A closed day is a signature, and the reason it is final is that a day
 * signed in March must read the same in September. Reopening is therefore
 * fenced to the one case that is a slip rather than a revision:
 *
 *   only TODAY'S. The day the shop is trading, by its own clock (ShopDay). A
 *   day the shop has lived past is signed off for good — reopening last
 *   week's to add a shift is rewriting the books, and no reason typed into a
 *   box makes it something else.
 *
 *   only while it is still the LATEST. If trading has already moved on to a
 *   newer day at this counter, opening the old one again leaves two running
 *   side by side, and every deposit and every shift after that has to guess
 *   which it belongs to — the bug `BusinessDay::openFor` was written to end.
 *
 *   only with a REASON, and by somebody who may close the day in the first
 *   place. Whoever signs can un-sign their own slip the same afternoon; the
 *   trail names them and keeps what the day had been signed off at.
 *
 * ── What happens to the figures ──────────────────────────────────────
 *
 * They are cleared. A day that is open has no roll-up — it is summed from
 * its shifts when it is closed, and it will be summed again, from every shift
 * including the ones still to come. Leaving the old totals on an open day
 * would show an owner a "day total" that stops at two o'clock.
 *
 * The shifts themselves are untouched: each drawer that was counted stays
 * counted, at the figure somebody put their name to. Nothing a cashier
 * signed for is reopened by this.
 */
class ReopenBusinessDayAction
{
    public function execute(User $user, BusinessDay $day, string $reason): BusinessDay
    {
        return DB::transaction(function () use ($user, $day, $reason): BusinessDay {
            /** @var BusinessDay $locked */
            $locked = BusinessDay::query()->whereKey($day->id)->lockForUpdate()->firstOrFail();

            if ($locked->isOpen()) {
                throw DomainException::conflict('This day is already open.', 'BUSINESS_DAY_OPEN');
            }

            $date = $locked->trading_date->toDateString();
            $nice = $locked->trading_date->format('j M Y');

            if ($date < ShopDay::today($user->tenant)) {
                throw DomainException::conflict(
                    "Only today's trading can be opened again. {$nice} is signed off, and stays as it was signed.",
                    'BUSINESS_DAY_TOO_OLD',
                );
            }

            $later = BusinessDay::query()
                ->where('branch_id', $locked->branch_id)
                ->whereDate('trading_date', '>', $date)
                ->orderBy('trading_date')
                ->first();

            if ($later !== null) {
                throw DomainException::conflict(
                    "Trading has already moved on to {$later->trading_date->format('j M Y')}. "
                    ."Opening {$nice} again would leave two days running at one counter.",
                    'BUSINESS_DAY_MOVED_ON',
                );
            }

            // What it had been signed off at — for the trail, before it goes.
            $signedOff = [
                'closed_at' => $locked->closed_at?->toIso8601String(),
                'shifts_count' => $locked->shifts_count,
                'sales_count' => $locked->sales_count,
                'sales_total' => (float) $locked->sales_total,
                'expected_cash' => (float) $locked->expected_cash,
                'counted_cash' => (float) $locked->counted_cash,
                'variance' => (float) $locked->variance,
                'banked_amount' => (float) $locked->banked_amount,
            ];

            // One line on the trail, written below and saying what happened.
            // The model's own "changed" row would be a second one listing
            // fifteen columns going to zero, which says the same thing worse.
            BusinessDay::withoutAuditing(fn () => $locked->update([
                'status' => BusinessDay::STATUS_OPEN,
                'closed_by' => null,
                'closed_at' => null,
                'shifts_count' => 0,
                'opening_float' => 0,
                'cash_sales' => 0,
                'cash_in' => 0,
                'cash_out' => 0,
                'expected_cash' => 0,
                'counted_cash' => 0,
                'variance' => 0,
                'sales_count' => 0,
                'sales_total' => 0,
                'banked_amount' => 0,
                'tender_mix' => null,
                'reopened_by' => $user->id,
                'reopened_at' => now(),
                'reopen_reason' => $reason,
            ]));

            AuditLog::query()->create([
                'user_id' => $user->id,
                'tenant_id' => $locked->tenant_id,
                'event' => 'reopened',
                'auditable_type' => BusinessDay::class,
                'auditable_id' => $locked->id,
                'old_values' => $signedOff,
                'new_values' => ['trading_date' => $date, 'reason' => $reason],
                'ip_address' => request()?->ip(),
            ]);

            return $locked->fresh(['branch', 'openedBy', 'reopenedBy']);
        });
    }

    /**
     * The closed day that COULD be opened again at this counter, if any.
     *
     * The same three fences as `execute`, asked without doing anything — so
     * the Day screen offers the button exactly when pressing it will work.
     * A button that is offered and then refuses is the thing this codebase
     * keeps finding.
     */
    public static function candidate(?string $branchId, ?User $user): ?BusinessDay
    {
        /** @var BusinessDay|null $latest */
        $latest = BusinessDay::query()
            ->where('branch_id', $branchId)
            ->latest('trading_date')
            ->first();

        if ($latest === null || $latest->isOpen()) {
            return null;
        }

        return $latest->trading_date->toDateString() >= ShopDay::today($user?->tenant) ? $latest : null;
    }

    /**
     * The same question for an owner looking at EVERY branch.
     *
     * A single-site shop is always in this view — its panel has no branch
     * switcher and sends no branch — so answering only for a chosen branch
     * would have offered the way back to nobody but chains.
     *
     * Reached only when no counter anywhere is trading (the screen shows the
     * open day otherwise), so the first is the one to offer; its branch is
     * named beside it.
     */
    public static function candidateAnywhere(?User $user): ?BusinessDay
    {
        return BusinessDay::query()
            ->whereNotNull('branch_id')
            ->where('status', BusinessDay::STATUS_CLOSED)
            ->whereDate('trading_date', '>=', ShopDay::today($user?->tenant))
            ->latest('trading_date')
            ->latest('closed_at')
            ->get()
            ->first(fn (BusinessDay $day): bool => self::candidate($day->branch_id, $user)?->is($day) ?? false);
    }
}
