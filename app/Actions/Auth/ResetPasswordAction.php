<?php

namespace App\Actions\Auth;

use App\Enums\OtpPurpose;
use App\Exceptions\DomainException;
use App\Services\OtpService;
use Illuminate\Support\Facades\DB;

/**
 * OTP-based password reset in a single call (identifier + code + new password).
 * The OTP is single-use (consumed inside verify) — token reuse is impossible.
 * All existing sessions are revoked after a successful reset.
 */
class ResetPasswordAction
{
    public function __construct(private readonly OtpService $otp) {}

    public function execute(string $identifier, string $code, string $password): void
    {
        DB::transaction(function () use ($identifier, $code, $password): void {
            $this->otp->verify($identifier, OtpPurpose::PasswordReset, $code);

            $user = $this->otp->findUser($identifier);

            if ($user === null) {
                throw DomainException::unauthorized('Invalid or expired code.', 'OTP_INVALID');
            }

            $user->forceFill([
                'password' => $password, // hashed by cast
                'failed_login_attempts' => 0,
                'locked_until' => null,
            ])->save();

            // A password reset invalidates every existing session.
            $user->tokens()->delete();
        });
    }
}
