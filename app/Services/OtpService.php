<?php

namespace App\Services;

use App\Enums\OtpPurpose;
use App\Exceptions\DomainException;
use App\Models\OtpCode;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;

/**
 * OTP lifecycle. Edge cases handled:
 *  - multiple requests      → previous unconsumed codes invalidated
 *  - expired code           → OTP_EXPIRED
 *  - wrong code             → attempt counter, max 5 → OTP_MAX_ATTEMPTS
 *  - reuse                  → single-use via consumed_at
 *  - resend flooding        → route-level throttle:otp (1/min, 5/hour)
 */
class OtpService
{
    public const TTL_MINUTES = 5;

    public const MAX_ATTEMPTS = 5;

    public function __construct(
        private readonly SmsSender $sms,
        private readonly EmailSender $email,
    ) {}

    /**
     * Create and dispatch a fresh code, invalidating older ones.
     */
    public function request(string $identifier, OtpPurpose $purpose, ?string $ip = null): OtpCode
    {
        $code = (string) random_int(100000, 999999);

        $otp = DB::transaction(function () use ($identifier, $purpose, $ip, $code) {
            // Multiple OTP requests: only the newest code may be valid.
            OtpCode::query()
                ->where('identifier', $identifier)
                ->where('purpose', $purpose)
                ->whereNull('consumed_at')
                ->delete();

            return OtpCode::query()->create([
                'user_id' => $this->findUser($identifier)?->id,
                'identifier' => $identifier,
                'code_hash' => Hash::make($code),
                'purpose' => $purpose,
                'expires_at' => now()->addMinutes(self::TTL_MINUTES),
                'ip_address' => $ip,
            ]);
        });

        $this->deliver($identifier, $code, $purpose);

        // Exposed only in local/debug so the flow is testable before
        // SMS/email providers land in Step 15.
        if (config('app.debug')) {
            $otp->setAttribute('debug_code', $code);
        }

        return $otp;
    }

    /**
     * Validate and consume a code. Throws DomainException on every failure mode.
     */
    public function verify(string $identifier, OtpPurpose $purpose, string $code): OtpCode
    {
        $mismatchedOtpId = null;

        try {
            // Transaction + row lock: two concurrent verifies of the same code
            // cannot both consume it.
            return DB::transaction(function () use ($identifier, $purpose, $code, &$mismatchedOtpId): OtpCode {
                /** @var OtpCode|null $otp */
                $otp = OtpCode::query()
                    ->where('identifier', $identifier)
                    ->where('purpose', $purpose)
                    ->whereNull('consumed_at')
                    ->latest('created_at')
                    ->lockForUpdate()
                    ->first();

                if ($otp === null) {
                    throw DomainException::unauthorized('Invalid or expired code.', 'OTP_INVALID');
                }

                if ($otp->isExpired()) {
                    throw DomainException::unauthorized('This code has expired. Please request a new one.', 'OTP_EXPIRED');
                }

                if ($otp->attempts >= self::MAX_ATTEMPTS) {
                    throw DomainException::unauthorized('Too many incorrect attempts. Please request a new code.', 'OTP_MAX_ATTEMPTS');
                }

                if (! Hash::check($code, $otp->code_hash)) {
                    // Recorded OUTSIDE this transaction — a rollback must
                    // never erase the failed-attempt counter.
                    $mismatchedOtpId = $otp->id;

                    throw DomainException::unauthorized('Invalid or expired code.', 'OTP_INVALID');
                }

                $otp->forceFill(['consumed_at' => now()])->save();

                return $otp;
            });
        } catch (DomainException $e) {
            if ($mismatchedOtpId !== null) {
                OtpCode::query()->whereKey($mismatchedOtpId)->increment('attempts');
            }

            throw $e;
        }
    }

    public function findUser(string $identifier): ?User
    {
        return User::query()
            ->where('email', $identifier)
            ->orWhere('phone', $identifier)
            ->first();
    }

    private function deliver(string $identifier, string $code, OtpPurpose $purpose): void
    {
        $message = "Your CartZe code is {$code}. It expires in ".self::TTL_MINUTES.' minutes.';

        // Route by identifier: email address → email, otherwise → SMS.
        if (filter_var($identifier, FILTER_VALIDATE_EMAIL)) {
            $this->email->send($identifier, 'Your CartZe verification code', $message);
        } else {
            $this->sms->send($identifier, $message);
        }

        Log::info('OTP issued', ['identifier' => $identifier, 'purpose' => $purpose->value]);
    }
}
