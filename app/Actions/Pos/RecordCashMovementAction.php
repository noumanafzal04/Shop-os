<?php

namespace App\Actions\Pos;

use App\Exceptions\DomainException;
use App\Models\CashMovement;
use App\Models\CashSession;
use App\Models\User;
use App\Support\DrawerMath;
use Illuminate\Support\Facades\DB;

/**
 * Records one non-sale cash event against a drawer.
 *
 * Guards, and the counter reality behind each:
 *  - the shift must be OPEN — you cannot move cash in a drawer that's counted
 *    and locked, and back-dating a movement into a closed shift would rewrite a
 *    variance somebody already signed off;
 *  - you cannot take out more than the drawer holds. A safe drop of Rs 50,000
 *    from a till holding Rs 12,000 is a typo (or a fiction), and letting it
 *    through would leave the shift expecting negative cash;
 *  - `no_sale` carries no amount — it's the drawer being opened, which is worth
 *    recording precisely because it's the gesture that precedes a quiet hand;
 *  - the session, lane and branch are resolved SERVER-side from the caller, so
 *    a client can never post a movement into someone else's drawer.
 */
class RecordCashMovementAction
{
    /**
     * @param  array{type: string, amount?: float|int|string|null, reason?: ?string, note?: ?string,
     *   source_type?: ?string, source_id?: ?string, approved_by?: ?string}  $data
     */
    public function execute(
        User $user,
        array $data,
        ?CashSession $session = null,
        bool $enforceDrawerLimit = true,
    ): CashMovement {
        $type = $data['type'];
        $direction = CashMovement::directionFor($type);

        return DB::transaction(function () use ($user, $data, $type, $direction, $session, $enforceDrawerLimit): CashMovement {
            $session ??= CashSession::query()
                ->where('user_id', $user->id)
                ->where('status', 'open')
                ->lockForUpdate()
                ->first();

            if ($session === null) {
                throw DomainException::conflict(
                    'Open a shift before recording cash movements.',
                    'SHIFT_REQUIRED',
                );
            }

            if (! $session->isOpen()) {
                throw DomainException::conflict('That shift is already closed.', 'SHIFT_NOT_OPEN');
            }

            // A no-sale is an event, not an amount.
            $amount = $direction === 'none' ? 0.0 : round((float) ($data['amount'] ?? 0), 2);

            if ($direction !== 'none' && $amount <= 0) {
                throw DomainException::unprocessable('Enter an amount greater than zero.', 'AMOUNT_REQUIRED');
            }

            // Only for cashier-entered movements. A system movement records
            // money that ALREADY moved (a void handed back, a supplier paid) —
            // refusing it because the drawer is short would make the ledger lie
            // about the real world.
            if ($direction === 'out' && $enforceDrawerLimit) {
                $inDrawer = DrawerMath::for($session)['expected_cash'];
                if ($amount > $inDrawer + 0.001) {
                    throw DomainException::unprocessable(
                        'That is more than the drawer holds ('.number_format($inDrawer, 2).').',
                        'INSUFFICIENT_DRAWER_CASH',
                    );
                }
            }

            return CashMovement::query()->create(array_filter([
                'tenant_id' => $user->tenant_id,
                'branch_id' => $session->branch_id,
                'register_id' => $session->register_id,
                'cash_session_id' => $session->id,
                'user_id' => $user->id,
                'type' => $type,
                'direction' => $direction,
                'amount' => $amount,
                'reason' => $data['reason'] ?? null,
                'note' => $data['note'] ?? null,
                'source_type' => $data['source_type'] ?? null,
                'source_id' => $data['source_id'] ?? null,
                'approved_by' => $data['approved_by'] ?? null,
                // Set only by the offline queue. Two `paid_out` rows of the
                // same amount on one shift are an ordinary thing for a shop to
                // do, so nothing else can tell a replay from a real second
                // payout — and without a key one lost acknowledgement takes the
                // money out of the drawer twice.
                'idempotency_key' => $data['idempotency_key'] ?? null,
                // WHEN the cash moved, when it is being recorded late. Absent
                // for everything typed at the counter, which is almost all of
                // them, and then Eloquent stamps it as usual.
                'created_at' => $data['created_at'] ?? null,
            ], fn ($value, $key): bool => $value !== null || ! in_array($key, ['idempotency_key', 'created_at'], true), ARRAY_FILTER_USE_BOTH));
        });
    }

    /**
     * Record a movement caused by another flow (a supplier paid from the till, a
     * khata repayment, a voided cash sale) against whatever drawer the actor has
     * open. Returns null when they have none — no drawer, no cash moved through
     * one, and inventing a movement would misstate someone else's till.
     *
     * @param  array<string, mixed>  $data
     */
    public function record(User $user, array $data): ?CashMovement
    {
        $session = CashSession::query()
            ->where('user_id', $user->id)
            ->where('status', 'open')
            ->first();

        if ($session === null) {
            return null;
        }

        return $this->execute($user, $data, $session, enforceDrawerLimit: false);
    }
}
