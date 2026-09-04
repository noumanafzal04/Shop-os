<?php

namespace App\Actions\Auth;

use App\Enums\OtpPurpose;
use App\Exceptions\DomainException;
use App\Models\User;
use App\Services\OtpService;

/**
 * Passwordless login: verify a login OTP, then issue tokens through the same
 * guard chain as password login.
 */
class OtpLoginAction
{
    public function __construct(
        private readonly OtpService $otp,
        private readonly EnsureUserCanAuthenticate $guards,
        private readonly IssueTokensAction $issueTokens,
    ) {}

    /**
     * @return array{user: User, tokens: array}
     */
    public function execute(string $identifier, string $code, string $deviceName = 'api'): array
    {
        $this->otp->verify($identifier, OtpPurpose::Login, $code);

        $user = $this->otp->findUser($identifier);

        if ($user === null) {
            // Code was valid but the account no longer exists (e.g. deleted
            // between request and verify). Same generic response.
            throw DomainException::unauthorized('Invalid or expired code.', 'OTP_INVALID');
        }

        $this->guards->execute($user);

        $user->forceFill([
            'failed_login_attempts' => 0,
            'locked_until' => null,
            'last_login_at' => now(),
            // A delivered+verified OTP proves ownership of the channel.
            ...(filter_var($identifier, FILTER_VALIDATE_EMAIL)
                ? ['email_verified_at' => $user->email_verified_at ?? now()]
                : ['phone_verified_at' => $user->phone_verified_at ?? now()]),
        ])->save();

        return [
            'user' => $user,
            'tokens' => $this->issueTokens->execute($user, $deviceName),
        ];
    }
}
