<?php

namespace App\Actions\Tenant;

use App\Enums\TenantStatus;
use App\Exceptions\DomainException;
use App\Models\Tenant;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Suspends a tenant and kills every active session of its users immediately —
 * suspension takes effect NOW, not at next login.
 */
class SuspendTenantAction
{
    public function execute(Tenant $tenant): Tenant
    {
        if ($tenant->isSuspended()) {
            throw DomainException::conflict('This tenant is already suspended.', 'TENANT_ALREADY_SUSPENDED');
        }

        return DB::transaction(function () use ($tenant): Tenant {
            $tenant->forceFill(['status' => TenantStatus::Suspended])->save();

            $userIds = $tenant->users()->pluck('id');

            PersonalAccessToken::query()
                ->where('tokenable_type', \App\Models\User::class)
                ->whereIn('tokenable_id', $userIds)
                ->delete();

            return $tenant;
        });
    }
}
