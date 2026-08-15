<?php

namespace App\Actions\Auth;

use App\Exceptions\DomainException;
use App\Models\User;

/**
 * Shared pre-auth guards (password login AND OTP login).
 *
 * Edge cases:
 *  - deleted account   → soft-deleted users never reach here (default scope)
 *                        so the response is a generic 401 — no user enumeration
 *  - suspended user    → 403 ACCOUNT_SUSPENDED
 *  - suspended tenant  → 403 TENANT_SUSPENDED at login time
 *  - deleted tenant    → 403 TENANT_DELETED
 *  - expired subscription → login ALLOWED (read-only enforcement in Step 11)
 *
 * ── Why the failed-attempt lock is NOT here ─────────────────────────────
 *
 * It used to be, and it was reachable by anyone who knew a shopkeeper's email.
 * Five wrong passwords locked the account for fifteen minutes — and because
 * this guard is shared, it locked the OTP route with it. A stranger could take
 * a shop off its own till at Friday rush hour, from anywhere, repeatedly, with
 * no credential at all.
 *
 * The lock is now applied where the credential is actually checked, and only to
 * a WRONG one. That keeps every bit of the brute-force protection — an attacker
 * still gets five guesses per fifteen minutes — while a shopkeeper who types
 * their own password correctly is never turned away. Nothing was traded for it:
 * a lock cannot stop somebody who already has the password, so refusing them
 * only ever cost the person it was meant to protect.
 *
 * These checks run on a PROVEN credential, which is also why the answers here
 * can be specific. "Your account has been suspended" is exactly what a
 * suspended owner needs to read, and it is not an oracle for anyone else,
 * because reaching this sentence at all means they got in.
 */
class EnsureUserCanAuthenticate
{
    public function execute(User $user): void
    {
        if (! $user->isActive()) {
            throw DomainException::forbidden('Your account has been suspended.', 'ACCOUNT_SUSPENDED');
        }

        if ($user->role->requiresTenant()) {
            $tenant = $user->tenant()->withTrashed()->first();

            if ($tenant === null) {
                throw DomainException::forbidden('No business is linked to this account.', 'TENANT_CONTEXT_MISSING');
            }

            if ($tenant->trashed()) {
                throw DomainException::forbidden('This business account has been deleted.', 'TENANT_DELETED');
            }

            if ($tenant->isSuspended()) {
                throw DomainException::forbidden('This business account is suspended.', 'TENANT_SUSPENDED');
            }
        }
    }
}
