<?php

namespace App\Actions\Staff;

use App\Exceptions\DomainException;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Soft-deletes a staff account and revokes all its sessions.
 * Self-deletion is blocked.
 */
class DeleteStaffAction
{
    public function execute(User $actor, User $staff): void
    {
        if ($actor->id === $staff->id) {
            throw DomainException::forbidden('You cannot delete your own account.', 'SELF_DELETION');
        }

        DB::transaction(function () use ($staff): void {
            $staff->tokens()->delete();
            $staff->delete();
        });
    }
}
