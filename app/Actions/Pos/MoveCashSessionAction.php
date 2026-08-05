<?php

namespace App\Actions\Pos;

use App\Exceptions\DomainException;
use App\Models\CashSession;
use App\Models\Register;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Terminal handover: moves a cashier's OWN open shift to another lane, drawer
 * and all.
 *
 * Real case this exists for — a lane's terminal dies mid-rush, or the shop
 * shuts the far lanes as the evening thins out. The cashier carries their
 * drawer to another lane and keeps going. Without this the only way out is to
 * close the shift and open a new one, which splits one physical drawer count
 * across two reconciliations and manufactures a variance on both.
 *
 * Everything already rung stays on the same session, so the close still counts
 * one drawer once. Only the LANE changes — the sales that were rung on the old
 * lane keep their own register stamp, which is what a per-lane report wants.
 */
class MoveCashSessionAction
{
    public function execute(User $user, Register $target): CashSession
    {
        return DB::transaction(function () use ($user, $target): CashSession {
            // Same lock as opening: the target lane must not be claimed out
            // from under this move.
            Register::query()->whereKey($target->id)->lockForUpdate()->first();

            /** @var CashSession|null $mine */
            $mine = CashSession::query()
                ->where('user_id', $user->id)
                ->where('status', 'open')
                ->first();

            if ($mine === null) {
                throw DomainException::conflict('You have no open shift to move.', 'SHIFT_NOT_OPEN');
            }

            if ($mine->register_id === $target->id) {
                return $mine; // already here — nothing to do
            }

            if (! $target->is_active) {
                throw DomainException::conflict('That register is not active.', 'REGISTER_INACTIVE');
            }

            $held = CashSession::query()
                ->with('user:id,name')
                ->where('register_id', $target->id)
                ->where('status', 'open')
                ->whereKeyNot($mine->id)
                ->first();

            if ($held !== null) {
                $who = $held->user?->name ?? 'another cashier';
                throw DomainException::conflict(
                    "{$target->name} already has an open shift ({$who}).",
                    'REGISTER_BUSY',
                );
            }

            $mine->forceFill([
                'register_id' => $target->id,
                // A lane at another site moves the shift's branch with it, so
                // the day's cash lands where it was actually taken.
                'branch_id' => $target->branch_id ?? $mine->branch_id,
            ])->save();

            return $mine->fresh();
        });
    }
}
