<?php

namespace App\Models\Concerns;

use App\Models\Tenant;
use App\Support\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Tenant isolation by construction:
 *  - global scope filters every query to the current tenant
 *  - tenant_id is auto-filled on create
 *  - creating a tenant-owned record without tenant context is a hard error,
 *    never a silent cross-tenant write.
 *
 * Super Admin queries that must span tenants use ::withoutTenancy() explicitly.
 */
trait BelongsToTenant
{
    public static function bootBelongsToTenant(): void
    {
        static::addGlobalScope('tenant', function (Builder $builder): void {
            $context = app(TenantContext::class);

            if ($context->has()) {
                $builder->where($builder->qualifyColumn('tenant_id'), $context->id());
            }
        });

        static::creating(function (Model $model): void {
            $context = app(TenantContext::class);

            if ($model->getAttribute('tenant_id') === null) {
                if (! $context->has()) {
                    throw new \RuntimeException(sprintf(
                        'Cannot create %s without a tenant context.',
                        static::class,
                    ));
                }

                $model->setAttribute('tenant_id', $context->id());
            }
        });
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /**
     * Explicit escape hatch for Super Admin / system jobs.
     */
    public static function withoutTenancy(): Builder
    {
        return static::query()->withoutGlobalScope('tenant');
    }
}
