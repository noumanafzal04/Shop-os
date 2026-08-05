<?php

namespace App\Rules;

use App\Models\CashSession;
use App\Models\User;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * A cash session named by the client must be the caller's OWN open shift.
 *
 * Why this rule exists: the sale/return/exchange endpoints accepted any open
 * session id belonging to the tenant. On a single-till shop that was harmless —
 * there was only ever one open shift. On a six-lane mart it means cashier B can
 * stamp their sale onto cashier A's drawer, and A carries the variance at close.
 * That is both an accountability hole and a ready-made cover for shrinkage:
 * ring the sale on someone else's lane, pocket the cash, let them come up short.
 *
 * The tenant scope still applies through the model's global scope, so this only
 * narrows "any open shift here" to "the shift I am standing at".
 */
class OwnOpenShift implements ValidationRule
{
    public function __construct(private readonly ?User $user) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        /** @var CashSession|null $session */
        $session = CashSession::query()->whereKey($value)->first();

        if ($session === null || $session->status !== 'open') {
            $fail('That shift is not open.');

            return;
        }

        if ($this->user === null || $session->user_id !== $this->user->id) {
            $fail('That shift belongs to another cashier. Ring this sale on your own shift.');
        }
    }
}
