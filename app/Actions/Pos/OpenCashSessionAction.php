<?php

namespace App\Actions\Pos;

use App\Exceptions\DomainException;
use App\Models\CashSession;
use App\Models\User;
use App\Support\BranchContext;

class OpenCashSessionAction
{
    public function __construct(private readonly BranchContext $branch) {}

    /** Opens a shift for the cashier on the operating branch's till. Rejects a second concurrent session. */
    public function execute(User $user, float $openingFloat): CashSession
    {
        $existing = CashSession::query()
            ->where('user_id', $user->id)
            ->where('status', 'open')
            ->first();

        if ($existing !== null) {
            throw DomainException::conflict('You already have an open shift.', 'SHIFT_ALREADY_OPEN');
        }

        return CashSession::query()->create([
            'tenant_id' => $user->tenant_id,
            // The till belongs to the branch the shift is opened on. A staff
            // member pinned to a branch resolves there; owners to the selected
            // (or Main) branch. Null on headless paths.
            'branch_id' => $this->branch->id() ?? $user->branch_id,
            'user_id' => $user->id,
            'status' => 'open',
            'opening_float' => round($openingFloat, 2),
            'opened_at' => now(),
        ]);
    }
}
