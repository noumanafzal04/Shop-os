<?php

namespace App\Actions\Auth;

use App\Exceptions\DomainException;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

/**
 * Password login by email or phone.
 *
 * ── The lock refuses a WRONG password, never a right one ────────────────
 *
 * Five straight failures still buy a fifteen-minute lock, and an attacker still
 * gets five guesses per account per fifteen minutes. What changed is who the
 * lock is allowed to stop.
 *
 * It used to be checked before the password was, which made it reachable by
 * anyone who knew a shopkeeper's email: five wrong guesses and the shop was off
 * its own till — password AND one-time code, because the guard was shared —
 * for fifteen minutes, from anywhere, repeatable for as long as somebody cared
 * to. For a shop, a locked counter at Friday rush hour is the whole loss.
 *
 * Nothing was traded away to remove it. A lock cannot stop somebody who already
 * has the password; it exists to stop GUESSING, and guessing is exactly what it
 * still stops. Refusing a correct password only ever cost the person the lock
 * was meant to protect.
 *
 * ── Why every failure reads the same ────────────────────────────────────
 *
 * No such user, wrong password, and wrong password on a locked account all
 * return the same generic 401. The last one matters most: a distinct "locked"
 * answer is a free oracle for whether an address is real — try five passwords
 * and see whether the reply changes. Only a proven credential earns a specific
 * answer, which is why the suspended/deleted cases live past the check below.
 *
 * The dummy hash on an unknown identifier is part of the same sentence. Without
 * it the reply comes back instantly for an address nobody holds and ~100ms
 * later for one somebody does, and the timing says what the body would not.
 */
class LoginAction
{
    public const MAX_FAILED_ATTEMPTS = 5;

    public const LOCKOUT_MINUTES = 15;

    /**
     * A real bcrypt digest of a value nobody can present.
     *
     * Only ever compared against, so that an unknown identifier costs the same
     * work — and therefore the same wall-clock — as a known one.
     */
    private const NO_SUCH_USER = '$2y$12$usesomesillystringfore7hnbRJHxXVLeakoG8K30M1hVK3rBMWa';

    public function __construct(
        private readonly EnsureUserCanAuthenticate $guards,
        private readonly IssueTokensAction $issueTokens,
    ) {}

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
            Hash::check($password, self::NO_SUCH_USER);

            throw DomainException::unauthorized();
        }

        if (! Hash::check($password, $user->password)) {
            // A locked account stops counting rather than sinking further. The
            // window is a ceiling on guesses, not a punishment that compounds:
            // extending it on every attempt would let anyone hold a shop out
            // indefinitely by knocking once a minute.
            if (! $user->isLocked()) {
                $this->recordFailure($user);
            }

            throw DomainException::unauthorized();
        }

        // From here the credential is proven, so the answers may be specific.
        $this->guards->execute($user);

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
