<?php

namespace App\Actions\Tenant;

use App\Models\Tenant;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Soft-deletes a tenant. Business data is NEVER hard-deleted — reports,
 * invoices and history survive for auditing/restoration. All user sessions
 * are revoked immediately.
 */
class DeleteTenantAction
{
    public function execute(Tenant $tenant): void
    {
        DB::transaction(function () use ($tenant): void {
            $userIds = $tenant->users()->pluck('id');

            PersonalAccessToken::query()
                ->where('tokenable_type', User::class)
                ->whereIn('tokenable_id', $userIds)
                ->delete();

            $tenant->delete(); // soft delete
        });
    }
}
