<?php

namespace App\Actions\Auth;

use App\Exceptions\DomainException;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

/**
 * Authenticated password change. Verifies the current password and revokes
 * every OTHER session — the device making the change stays logged in.
 */
class ChangePasswordAction
{
    public function execute(User $user, string $currentPassword, string $newPassword): void
    {
        if (! Hash::check($currentPassword, $user->password)) {
            throw DomainException::unprocessable('The current password is incorrect.', 'CURRENT_PASSWORD_MISMATCH');
        }

        $user->forceFill(['password' => $newPassword])->save();

        $currentTokenId = $user->currentAccessToken()?->id;

        $user->tokens()
            ->when($currentTokenId, fn ($q) => $q->where('id', '!=', $currentTokenId))
            ->delete();
    }
}
