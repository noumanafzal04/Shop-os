<?php

namespace App\Actions\Auth;

use App\Models\User;

/**
 * Issues an access/refresh token pair. Multi-device by design: each login
 * creates its own pair, so one device logging out never kills another.
 */
class IssueTokensAction
{
    public const ACCESS_TTL_MINUTES = 60;

    public const REFRESH_TTL_DAYS = 30;

    /**
     * @return array{access_token: string, refresh_token: string, token_type: string, expires_in: int}
     */
    public function execute(User $user, string $deviceName = 'api'): array
    {
        $access = $user->createToken(
            name: $deviceName,
            abilities: ['access'],
            expiresAt: now()->addMinutes(self::ACCESS_TTL_MINUTES),
        );

        $refresh = $user->createToken(
            name: $deviceName.':refresh',
            abilities: ['refresh'],
            expiresAt: now()->addDays(self::REFRESH_TTL_DAYS),
        );

        return [
            'access_token' => $access->plainTextToken,
            'refresh_token' => $refresh->plainTextToken,
            'token_type' => 'Bearer',
            'expires_in' => self::ACCESS_TTL_MINUTES * 60,
        ];
    }
}
