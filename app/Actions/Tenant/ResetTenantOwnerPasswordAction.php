<?php

namespace App\Actions\Tenant;

use App\Enums\UserRole;
use App\Exceptions\DomainException;
use App\Models\AuditLog;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * A shop owner locked out of their own business, put back in.
 *
 * Until now there was no path at all: password reset needs an OTP to a phone or
 * an email the owner may no longer have, and the only remaining option was
 * someone opening a MySQL console against production. That is not a recovery
 * procedure, it is an outage with a workaround.
 *
 * Three things make this safe enough to expose:
 *
 *  - It is reachable only with `tenants.reset_password`, which is its own
 *    permission rather than part of `tenants.update`. Support staff who fix
 *    typos in shop addresses do not get the keys to the till.
 *  - Every session the owner had is destroyed. A password the owner did not
 *    choose has to invalidate whatever is already holding a token, or a reset
 *    prompted by "someone else is in my account" leaves that someone in it.
 *  - It writes its own audit row naming the acting admin AND the owner. The
 *    Auditable trait would log an `updated` event with no values (password is
 *    excluded from audit payloads, correctly), which is indistinguishable from
 *    any other edit. For the one action that can impersonate a business, the
 *    trail has to say what happened.
 *
 * The new password is never returned by the API. The admin typed it and hands
 * it over by whatever channel they already trust; echoing it back would put it
 * in browser history, proxy logs and the network tab for no benefit.
 */
class ResetTenantOwnerPasswordAction
{
    public function execute(User $actor, Tenant $tenant, string $password, ?string $userId = null): User
    {
        return DB::transaction(function () use ($actor, $tenant, $password, $userId): User {
            $owner = $this->resolveOwner($tenant, $userId);

            $owner->forceFill(['password' => $password])->save();

            // Not "other sessions" — every session. The admin is not the owner,
            // so there is no current device here worth preserving, and the
            // likeliest reason for this call is that a session exists which
            // should not.
            $owner->tokens()->delete();

            AuditLog::query()->create([
                'user_id' => $actor->id,
                'tenant_id' => $tenant->id,
                'event' => 'owner_password_reset',
                'auditable_type' => User::class,
                'auditable_id' => $owner->id,
                'old_values' => null,
                'new_values' => [
                    'owner_name' => $owner->name,
                    'owner_email' => $owner->email,
                    'sessions_revoked' => true,
                ],
                'ip_address' => request()?->ip(),
            ]);

            return $owner;
        });
    }

    /**
     * Which owner. Most shops have exactly one, and naming them is friction for
     * no gain — but a shop with two partners must not have "the first row" get
     * silently picked, because the admin would then hand the new password to
     * the wrong person and both would believe they were locked out.
     */
    private function resolveOwner(Tenant $tenant, ?string $userId): User
    {
        $owners = User::query()
            ->where('tenant_id', $tenant->id)
            ->where('role', UserRole::ShopOwner)
            ->orderBy('created_at')
            ->get();

        if ($owners->isEmpty()) {
            throw DomainException::unprocessable(
                'This business has no owner account to reset.',
                'TENANT_HAS_NO_OWNER',
            );
        }

        if ($userId !== null) {
            $owner = $owners->firstWhere('id', $userId);

            if ($owner === null) {
                throw DomainException::unprocessable(
                    'That user is not an owner of this business.',
                    'NOT_AN_OWNER_OF_THIS_TENANT',
                );
            }

            return $owner;
        }

        if ($owners->count() > 1) {
            throw DomainException::unprocessable(
                'This business has '.$owners->count().' owners — choose which one to reset.',
                'MULTIPLE_OWNERS',
            );
        }

        return $owners->first();
    }
}
