<?php

namespace App\Actions\Staff;

use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Exceptions\DomainException;
use App\Models\User;

/**
 * Creates a staff account — platform staff (admin_staff) or tenant staff
 * (staff) depending on who is creating.
 *
 * Anti-escalation: a staff member managing other staff can only grant
 * permissions they hold themselves. Scope owners can grant anything
 * in their scope.
 */
class CreateStaffAction
{
    public function execute(User $actor, array $data, UserRole $role, ?string $tenantId = null): User
    {
        $this->guardEscalation($actor, $data['permissions'] ?? []);

        return User::query()->create([
            'tenant_id' => $tenantId,
            'name' => $data['name'],
            'email' => $data['email'] ?? null,
            'phone' => $data['phone'] ?? null,
            'password' => $data['password'],
            'role' => $role,
            'status' => UserStatus::Active,
            'permissions' => array_values(array_unique($data['permissions'] ?? [])),
        ]);
    }

    private function guardEscalation(User $actor, array $requested): void
    {
        if (in_array($actor->role, [UserRole::SuperAdmin, UserRole::ShopOwner], strict: true)) {
            return; // scope owners can grant anything within the validated scope list
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
