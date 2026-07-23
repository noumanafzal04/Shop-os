<?php

namespace App\Actions\Auth;

use App\Exceptions\DomainException;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

/**
 * Password login by email or phone.
 *
 * Brute force: 5 straight failures → 15-minute lock. The failure response is
 * identical for "no such user" and "wrong password" — no user enumeration.
 */
class LoginAction
{
    public const MAX_FAILED_ATTEMPTS = 5;

    public const LOCKOUT_MINUTES = 15;

    public function __construct(
        private readonly EnsureUserCanAuthenticate $guards,
        private readonly IssueTokensAction $issueTokens,
    ) {
    }

    /**
     * @return array{user: User, tokens: array}
     */
    public function execute(string $identifier, string $password, string $deviceName = 'api'): array
    {
        /** @var User|null $user */
        $user = User::query()
            ->where('email', $identifier)
            ->orWhere('phone', $identifier)
            ->first();

        if ($user === null) {
            throw DomainException::unauthorized();
        }

        $this->guards->execute($user);

        if (! Hash::check($password, $user->password)) {
            $this->recordFailure($user);

            throw DomainException::unauthorized();
        }

        $user->forceFill([
            'failed_login_attempts' => 0,
            'locked_until' => null,
            'last_login_at' => now(),
        ])->save();

        return [
            'user' => $user,
            'tokens' => $this->issueTokens->execute($user, $deviceName),
        ];
    }

    private function recordFailure(User $user): void
    {
        $attempts = $user->failed_login_attempts + 1;

        $user->forceFill([
            'failed_login_attempts' => $attempts,
            'locked_until' => $attempts >= self::MAX_FAILED_ATTEMPTS
                ? now()->addMinutes(self::LOCKOUT_MINUTES)
                : null,
        ])->save();
    }
}
