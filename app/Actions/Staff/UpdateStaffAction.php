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
 *  - suspension revokes every session immediately
 */
class UpdateStaffAction
{
    public function execute(User $actor, User $staff, array $data): User
    {
        if (isset($data['permissions'])) {
            $this->guardEscalation($actor, $data['permissions']);
            $data['permissions'] = array_values(array_unique($data['permissions']));
        }

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
