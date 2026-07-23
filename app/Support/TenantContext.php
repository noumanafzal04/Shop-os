<?php

namespace App\Support;

use App\Models\Tenant;

/**
 * Holds the tenant for the current request. Registered as a scoped singleton,
 * resolved once by ResolveTenant middleware, consumed by the BelongsToTenant
 * global scope. Never trust a client-supplied tenant id — the tenant always
 * comes from the authenticated user.
 */
class TenantContext
{
    private ?Tenant $tenant = null;

    public function set(Tenant $tenant): void
    {
        $this->tenant = $tenant;
    }

    public function get(): ?Tenant
    {
        return $this->tenant;
    }

    public function id(): ?string
    {
        return $this->tenant?->id;
    }

    public function has(): bool
    {
        return $this->tenant !== null;
    }

    public function clear(): void
    {
        $this->tenant = null;
    }
}
