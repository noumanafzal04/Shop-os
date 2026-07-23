<?php

namespace App\Actions\Tenant;

use App\Enums\TenantStatus;
use App\Exceptions\DomainException;
use App\Models\Tenant;

class ActivateTenantAction
{
    public function execute(Tenant $tenant): Tenant
    {
        if ($tenant->isActive()) {
            throw DomainException::conflict('This tenant is already active.', 'TENANT_ALREADY_ACTIVE');
        }

        $tenant->forceFill(['status' => TenantStatus::Active])->save();

        return $tenant;
    }
}
