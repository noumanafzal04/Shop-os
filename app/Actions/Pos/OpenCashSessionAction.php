<?php

namespace App\Actions\Pos;

use App\Exceptions\DomainException;
use App\Models\CashSession;
use App\Models\Register;
use App\Models\User;
use App\Support\BranchContext;
use Illuminate\Support\Facades\DB;

/**
 * Opens a shift. A shift is CASHIER × TERMINAL: six lanes at a mart can all be
 * open at once, each reconciling its own drawer.
 *
 * The rules, and why:
 *   - one open shift per LANE — the drawer is a physical box; two cashiers
 *     counting the same one at close is a guaranteed variance;
 *   - one open shift per CASHIER — a person stands at one lane at a time, and
 *     cash rung on lane 1 must not land in lane 2's reconciliation;
 *   - re-opening on the LANE YOU ALREADY HOLD is a RESUME, not an error. This
 *     is the case that used to hard-block a cashier: a refresh, a dead tablet
 *     or a re-login left the shift open and the cashier locked out of their own
 *     till with SHIFT_ALREADY_OPEN and no way back in;
 *   - holding a shift on ANOTHER lane is a real conflict, but a recoverable
 *     one: SHIFT_OPEN_ELSEWHERE names the lane, and the cashier either closes
 *     it there or moves it here (MoveCashSessionAction).
 *
 * A shop with no registers configured behaves exactly as it always did.
 */
class OpenCashSessionAction
{
    public function __construct(private readonly BranchContext $branch) {}

    public function execute(User $user, float $openingFloat, ?Register $register = null): CashSession
    {
        return DB::transaction(function () use ($user, $openingFloat, $register): CashSession {
            if ($register !== null) {
                // Serialise concurrent opens on the same lane: two cashiers
                // tapping "Open shift" on lane 3 at the same instant must not
                // both win. The loser waits here, then sees REGISTER_BUSY.
                Register::query()->whereKey($register->id)->lockForUpdate()->first();
            }

            /** @var CashSession|null $mine */
            $mine = CashSession::query()
                ->where('user_id', $user->id)
                ->where('status', 'open')
                ->first();

            // Someone else already on this lane → the lane is taken.
            if ($register !== null) {
                $held = CashSession::query()
                    ->with('user:id,name')
                    ->where('register_id', $register->id)
                    ->where('status', 'open')
                    ->when($mine !== null, fn ($q) => $q->whereKeyNot($mine->id))
                    ->first();

                if ($held !== null) {
                    $who = $held->user?->name ?? 'another cashier';
                    throw DomainException::conflict(
                        "{$register->name} already has an open shift ({$who}). Close that shift, or use another register.",
                        'REGISTER_BUSY',
                    );
                }
            }

            if ($mine !== null) {
                // Same lane → resume the shift already in progress.
                if ($register !== null && $mine->register_id === $register->id) {
                    return $mine;
                }

                // A shift opened before the shop had lanes: adopt this terminal
                // rather than strand the cashier mid-day.
                if ($register !== null && $mine->register_id === null) {
                    $mine->forceFill([
                        'register_id' => $register->id,
                        'branch_id' => $mine->branch_id ?? $register->branch_id,
                    ])->save();

                    return $mine;
                }

                if ($mine->register_id !== null) {
                    $lane = Register::query()->whereKey($mine->register_id)->first();
                    throw DomainException::conflict(
                        'You already have an open shift on '.($lane?->name ?? 'another register')
                            .'. Close it there, or move it to this register.',
                        'SHIFT_OPEN_ELSEWHERE',
                    );
                }

                throw DomainException::conflict('You already have an open shift.', 'SHIFT_ALREADY_OPEN');
            }

            return CashSession::query()->create([
                'tenant_id' => $user->tenant_id,
                // The till belongs to the branch the shift is opened on. A lane
                // pins it exactly; otherwise a staff member pinned to a branch
                // resolves there and owners to the selected (or Main) branch.
                'branch_id' => $register?->branch_id ?? $this->branch->id() ?? $user->branch_id,
                'register_id' => $register?->id,
                'user_id' => $user->id,
                'status' => 'open',
                'opening_float' => round($openingFloat, 2),
                'opened_at' => now(),
            ]);
        });
    }
}
