<?php

namespace App\Actions\Pos;

use App\Exceptions\DomainException;
use App\Models\CashSession;
use App\Models\User;

class OpenCashSessionAction
{
    /** Opens a shift for the cashier. Rejects a second concurrent session. */
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
            'user_id' => $user->id,
            'status' => 'open',
            'opening_float' => round($openingFloat, 2),
            'opened_at' => now(),
        ]);
    }
}
