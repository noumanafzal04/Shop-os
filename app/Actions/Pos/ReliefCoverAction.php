<?php

namespace App\Actions\Pos;

use App\Exceptions\DomainException;
use App\Models\CashSession;
use App\Models\CashSessionCover;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Standing in for the cashier who stepped away.
 *
 * The one rule everything here protects: A COVER MOVES THE QUEUE, NOT THE
 * DRAWER. The reliever gets the right to ring sales under their own name; the
 * cashier who opened the shift is still the one who will count the box and wear
 * the variance. Nothing in here changes `cash_sessions.user_id`.
 *
 * That is also why a cover cannot be opened by someone who already holds a
 * drawer of their own. Two open drawers and one screen is how cash ends up in
 * the wrong box — and the case is not worth the risk, because the person who
 * actually covers a ten-minute break is the owner or a floor staffer, and
 * neither of them is holding a lane.
 */
class ReliefCoverAction
{
    /**
     * Take over the lane. `$session` is the drawer being covered — the one
     * already open on this terminal, not the caller's.
     */
    public function start(User $reliever, CashSession $session, ?string $reason = null): CashSessionCover
    {
        return DB::transaction(function () use ($reliever, $session, $reason): CashSessionCover {
            // Serialise two people tapping "Cover" on the same lane at once.
            CashSession::query()->whereKey($session->id)->lockForUpdate()->first();

            if (! $session->isOpen()) {
                throw DomainException::conflict(
                    'That shift is closed. Open your own shift on this register instead.',
                    'SHIFT_NOT_OPEN',
                );
            }

            if ($session->user_id === $reliever->id) {
                throw DomainException::conflict(
                    'This is your own drawer — there is nothing to cover.',
                    'CANNOT_COVER_OWN_SHIFT',
                );
            }

            $mine = CashSession::query()
                ->where('user_id', $reliever->id)
                ->where('status', 'open')
                ->first();

            if ($mine !== null) {
                throw DomainException::conflict(
                    'You have your own drawer open. A reliever rings into the drawer they are '
                        .'standing at, so close or move your own shift first.',
                    'ALREADY_ON_A_SHIFT',
                );
            }

            $active = $session->activeCover();

            if ($active !== null) {
                // Already yours: tapping Cover twice is a double-tap, not an error.
                if ($active->user_id === $reliever->id) {
                    return $active;
                }

                throw DomainException::conflict(
                    ($active->user?->name ?? 'Someone else').' is already covering this till.',
                    'ALREADY_COVERED',
                );
            }

            return CashSessionCover::query()->create([
                'tenant_id' => $session->tenant_id,
                'cash_session_id' => $session->id,
                'user_id' => $reliever->id,
                'started_at' => now(),
                'reason' => $reason,
            ])->refresh();
        });
    }

    /**
     * Hand the till back.
     *
     * The figures are frozen HERE, for the same reason a Z-read freezes: "what
     * did the reliever take" is a question asked when the drawer is short, and
     * an answer that drifts as sales are later voided settles nothing.
     */
    public function end(CashSessionCover $cover, ?User $endedBy = null): CashSessionCover
    {
        if (! $cover->isOpen()) {
            return $cover;
        }

        return DB::transaction(function () use ($cover, $endedBy): CashSessionCover {
            $figures = $cover->live();

            $cover->forceFill([
                'ended_at' => now(),
                'ended_by' => $endedBy?->id,
                ...$figures,
            ])->save();

            return $cover;
        });
    }

    /** End whatever cover is running on this shift, if any. Idempotent. */
    public function endFor(CashSession $session, ?User $endedBy = null): ?CashSessionCover
    {
        $active = $session->activeCover();

        return $active === null ? null : $this->end($active, $endedBy);
    }
}
