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
 *  - locked account    → 423-style lockout after repeated failures
 *  - suspended tenant  → 403 TENANT_SUSPENDED at login time
 *  - deleted tenant    → 403 TENANT_DELETED
 *  - expired subscription → login ALLOWED (read-only enforcement in Step 11)
 */
class EnsureUserCanAuthenticate
{
    public function execute(User $user): void
    {
        if ($user->isLocked()) {
            throw new DomainException(
                'Account temporarily locked due to repeated failed attempts. Try again later.',
                429,
                'ACCOUNT_LOCKED',
            );
        }

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
