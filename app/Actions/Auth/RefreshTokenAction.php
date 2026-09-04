<?php

namespace App\Actions\Auth;

use App\Exceptions\DomainException;
use App\Models\User;

/**
 * Rotates a refresh token: the presented refresh token is revoked and a new
 * access/refresh pair is issued. A stolen refresh token therefore dies the
 * moment the legitimate client rotates first.
 */
class RefreshTokenAction
{
    public function __construct(
        private readonly EnsureUserCanAuthenticate $guards,
        private readonly IssueTokensAction $issueTokens,
    ) {}

    public function execute(User $user): array
    {
        $current = $user->currentAccessToken();

        if ($current === null || ! $user->tokenCan('refresh')) {
            throw DomainException::unauthorized('A refresh token is required.', 'REFRESH_TOKEN_REQUIRED');
        }

        // Re-check account/tenant state — suspension takes effect on refresh.
        $this->guards->execute($user);

        $deviceName = str_replace(':refresh', '', $current->name);

        // Single-use: revoke the presented refresh token.
        $current->delete();

        return $this->issueTokens->execute($user, $deviceName);
    }
}
