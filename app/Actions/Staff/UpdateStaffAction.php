<?php

namespace App\Actions\Staff;

use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Exceptions\DomainException;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Updates a staff account (name, contact, permissions, status, password).
 *
 * Edge cases:
 *  - self-suspension blocked
 *  - permission escalation blocked (staff actors)
 *  - ACCOUNT TAKEOVER blocked — see below
 *  - suspension revokes every session immediately
 *
 * ── Why changing somebody's password is an escalation ───────────────────
 *
 * `guardEscalation` stops a staff actor granting a permission they do not hold
 * themselves. It was complete about permissions and blind about identity.
 *
 * A manager holding `staff.manage` but not, say, cost visibility cannot tick
 * that box for themselves — and did not need to. They could set a cashier's
 * password to something they chose, sign in as that cashier, and read whatever
 * the cashier could. Email and phone are the same door: login is by either, so
 * moving a colleague's address to one you control hands you their next
 * one-time code.
 *
 * The rule that closes all three is one sentence: **you may only take over an
 * account you could have created.** That is exactly the test `guardEscalation`
 * already applies to a permission list — pointed at the TARGET's permissions
 * rather than the requested ones.
 *
 * A shop owner is exempt, as everywhere else here: they hold every permission
 * implicitly, so there is nothing for them to acquire.
 *
 * Not reachable through any shipped job preset — `staff.manage` deliberately
 * stays with the owner. It becomes reachable the moment an owner ticks it for
 * a manager, which is a box the screen offers, and a guard whose protection
 * ends where the configuration begins is not a guard.
 */
class UpdateStaffAction
{
    public function execute(User $actor, User $staff, array $data): User
    {
        if (isset($data['permissions'])) {
            $this->guardEscalation($actor, $data['permissions']);
            $data['permissions'] = array_values(array_unique($data['permissions']));
        }

        $this->guardTakeover($actor, $staff, $data);

        $suspending = isset($data['status'])
            && $data['status'] === UserStatus::Suspended->value
            && $staff->isActive();

        if ($suspending && $actor->id === $staff->id) {
            throw DomainException::forbidden('You cannot suspend your own account.', 'SELF_SUSPENSION');
        }

        return DB::transaction(function () use ($staff, $data, $suspending): User {
            $staff->fill($data)->save();

            if ($suspending) {
                $staff->tokens()->delete();
            }

            return $staff->refresh();
        });
    }

    /**
     * Changing the credentials somebody signs in with is taking their account.
     *
     * So it is allowed only when the actor could have held that account's
     * permissions anyway — otherwise every permission they were deliberately
     * not given is one password change away.
     */
    private function guardTakeover(User $actor, User $staff, array $data): void
    {
        $credentials = array_intersect(['password', 'email', 'phone'], array_keys($data));

        if ($credentials === [] || $actor->id === $staff->id) {
            return;
        }

        $this->guardEscalation($actor, $staff->permissions ?? []);
    }

    private function guardEscalation(User $actor, array $requested): void
    {
        if (in_array($actor->role, [UserRole::SuperAdmin, UserRole::ShopOwner], strict: true)) {
            return;
        }

        $missing = array_diff($requested, $actor->permissions ?? []);

        if ($missing !== []) {
            throw DomainException::forbidden(
                'You cannot grant permissions you do not hold yourself: '.implode(', ', $missing),
                'PERMISSION_ESCALATION',
            );
        }
    }
}
