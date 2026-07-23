<?php

namespace App\Actions\Tenant;

use App\Models\Tenant;

class UpdateTenantAction
{
    public function execute(Tenant $tenant, array $data): Tenant
    {
        $tenant->fill($data)->save();

        return $tenant->load('city', 'plan');
    }
}
