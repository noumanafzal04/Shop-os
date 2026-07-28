<?php

namespace App\Support;

use App\Enums\UserRole;
use App\Exceptions\DomainException;
use App\Models\Branch;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;

/**
 * The plan-limit engine. Plans define baseline ceilings (max_products,
 * max_staff…); a single tenant can be "extended" past its plan via
 * tenants.limit_overrides without minting a new plan. This class is the one
 * place that resolves the EFFECTIVE ceiling, measures live usage, and enforces
 * it — so every caller agrees on the numbers.
 *
 * Design choices:
 *  - Usage is counted LIVE (a query), never a stored counter. No drift, no
 *    increment/decrement bookkeeping, no recount job — the source of truth is
 *    the rows themselves.
 *  - NULL limit = UNLIMITED. A tenant with no plan is unlimited (nothing to
 *    meter against) — this keeps unprovisioned/test tenants unrestricted.
 *  - Only resources that physically exist today are metered (products, staff,
 *    monthly orders). `branches` and `storage_mb` are declared so the admin can
 *    configure them, but enforcement wires in when those subsystems land
 *    (branches = multi-branch step; storage = image byte accounting).
 */
class PlanLimits
{
    /**
     * The configurable limits: key => [plan column, human label, enforced?].
     * `enforced` false = admin-configurable + surfaced in usage, but no hard
     * block yet (the resource/metering doesn't exist).
     */
    public const REGISTRY = [
        'products' => ['column' => 'max_products', 'label' => 'products', 'enforced' => true],
        'staff' => ['column' => 'max_staff', 'label' => 'staff members', 'enforced' => true],
        'orders_month' => ['column' => 'max_orders_month', 'label' => 'orders this month', 'enforced' => false],
        'branches' => ['column' => 'max_branches', 'label' => 'branches', 'enforced' => true],
        'storage_mb' => ['column' => 'max_storage_mb', 'label' => 'MB of storage', 'enforced' => false],
    ];

    /**
     * Effective ceiling for a resource: the tenant's per-tenant override if set,
     * otherwise the plan's baseline. NULL = unlimited (no plan, no column value,
     * or an explicit unlimited).
     */
    public static function limit(Tenant $tenant, string $key): ?int
    {
        $override = $tenant->limit_overrides[$key] ?? null;
        if ($override !== null && $override !== '') {
            return (int) $override;
        }

        $column = self::REGISTRY[$key]['column'] ?? null;
        if ($column === null) {
            return null;
        }

        $tenant->loadMissing('plan');
        $planLimit = $tenant->plan?->{$column};

        return $planLimit === null ? null : (int) $planLimit;
    }

    /**
     * Live usage count for a resource — the actual rows on hand right now.
     */
    public static function usage(Tenant $tenant, string $key): int
    {
        return match ($key) {
            'products' => Product::withoutTenancy()->where('tenant_id', $tenant->id)->count(),
            // Owner is not "staff" — only additional staff members count.
            'staff' => $tenant->users()->where('role', UserRole::Staff)->count(),
            'orders_month' => Sale::withoutTenancy()->where('tenant_id', $tenant->id)
                ->where('created_at', '>=', now()->startOfMonth())->count(),
            // The default "Main" branch counts — a max_branches of 1 means the
            // single Main branch and no more (raising it unlocks extra sites).
            'branches' => Branch::withoutTenancy()->where('tenant_id', $tenant->id)->count(),
            // Not yet metered — subsystem lands later.
            'storage_mb' => 0,
            default => 0,
        };
    }

    /**
     * Throw LIMIT_REACHED if creating `$adding` more would exceed the effective
     * ceiling. No-op for unlimited (NULL) limits or unmetered keys. Call this
     * BEFORE the write.
     */
    public static function assert(Tenant $tenant, string $key, int $adding = 1): void
    {
        if (! (self::REGISTRY[$key]['enforced'] ?? false)) {
            return;
        }

        $limit = self::limit($tenant, $key);
        if ($limit === null) {
            return; // unlimited
        }

        if (self::usage($tenant, $key) + $adding > $limit) {
            $label = self::REGISTRY[$key]['label'];
            throw DomainException::unprocessable(
                "You've reached your plan limit of {$limit} {$label}. Upgrade your plan or ask support to extend this limit to add more.",
                'LIMIT_REACHED',
            );
        }
    }

    /**
     * Full usage-vs-limit picture for a tenant — one row per configurable
     * limit. Powers the admin's per-tenant "Extend limits" panel and the shop's
     * own usage meters. `remaining` is null when unlimited.
     *
     * @return array<int, array{key:string,label:string,limit:int|null,used:int,remaining:int|null,unlimited:bool,enforced:bool}>
     */
    public static function snapshot(Tenant $tenant): array
    {
        $tenant->loadMissing('plan');

        return collect(self::REGISTRY)->map(function (array $meta, string $key) use ($tenant): array {
            $limit = self::limit($tenant, $key);
            $used = self::usage($tenant, $key);

            return [
                'key' => $key,
                'label' => $meta['label'],
                'limit' => $limit,
                'used' => $used,
                'remaining' => $limit === null ? null : max(0, $limit - $used),
                'unlimited' => $limit === null,
                'enforced' => $meta['enforced'],
            ];
        })->values()->all();
    }
}
