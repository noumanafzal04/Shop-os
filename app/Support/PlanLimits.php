<?php

namespace App\Support;

use App\Enums\UserRole;
use App\Exceptions\DomainException;
use App\Models\Branch;
use App\Models\Product;
use App\Models\Register;
use App\Models\Sale;
use App\Models\Tenant;

/**
 * The limit engine — one place that resolves the effective ceiling for a
 * resource, measures live usage, and enforces it.
 *
 * Every limit has an OWNER, and that is the whole design:
 *
 *   owner = 'plan'    Usage that scales with what the shop consumes — products,
 *                     storage, orders a month. This is what a plan is for: you
 *                     pay more, you may hold more. The plan sets the baseline;
 *                     a single tenant can still be extended past it without
 *                     minting a bespoke plan.
 *
 *   owner = 'tenant'  The size of the organisation — branches, staff members,
 *                     checkout lanes. These are ASSIGNED to a shop when it is
 *                     created and changed by an admin afterwards. They were
 *                     plan columns once, which meant a two-branch shop needed
 *                     its own plan; now the admin simply gives it two.
 *
 * Both live in the same place (`tenants.limits`), so there is one column to
 * read, one endpoint to change, and one screen that shows all of it.
 *
 * Other design choices:
 *  - Usage is counted LIVE (a query), never a stored counter. No drift, no
 *    increment bookkeeping, no recount job — the rows are the truth.
 *  - NULL on a plan-owned limit = UNLIMITED. A tenant with no plan is unlimited
 *    on those, which keeps unprovisioned and test tenants unrestricted.
 *  - Tenant-owned limits are never unlimited. An unset one falls back to the
 *    platform default below, because "however many staff accounts you like" is
 *    how a shop ends up with forty of them and notices in an audit.
 */
class PlanLimits
{
    /**
     * key => [
     *   owner    'plan' (billed usage) | 'tenant' (assigned organisation size)
     *   column   plan column, plan-owned keys only
     *   default  fallback when a tenant-owned key was never assigned
     *   label    human noun, used in the refusal message
     *   enforced false = configurable + reported, but no hard block yet
     * ]
     */
    public const REGISTRY = [
        // ── Billed usage: the plan sets the baseline ────────────────────
        'products' => ['owner' => 'plan', 'column' => 'max_products', 'label' => 'products', 'enforced' => true],
        'orders_month' => ['owner' => 'plan', 'column' => 'max_orders_month', 'label' => 'orders this month', 'enforced' => false],
        // Declared so it is configurable and visible; enforcement wires in when
        // image byte accounting lands.
        'storage_mb' => ['owner' => 'plan', 'column' => 'max_storage_mb', 'label' => 'MB of storage', 'enforced' => false],

        // ── Assigned to the shop itself ─────────────────────────────────
        // The default "Main" branch counts, so 1 means Main and no more.
        'branches' => ['owner' => 'tenant', 'default' => 1, 'label' => 'branches', 'enforced' => true],
        // The owner is not "staff" — only additional accounts count.
        'staff' => ['owner' => 'tenant', 'default' => 5, 'label' => 'staff members', 'enforced' => true],
        // Checkout lanes. A single-counter shop needs no register row at all,
        // so most tenants sit at zero used.
        'registers' => ['owner' => 'tenant', 'default' => 2, 'label' => 'registers', 'enforced' => true],
    ];

    /** Limits the admin assigns to a shop rather than selling on a plan. */
    public static function assignedKeys(): array
    {
        return array_keys(array_filter(self::REGISTRY, fn ($m) => $m['owner'] === 'tenant'));
    }

    /** Limits a plan sets the baseline for. */
    public static function billedKeys(): array
    {
        return array_keys(array_filter(self::REGISTRY, fn ($m) => $m['owner'] === 'plan'));
    }

    /**
     * Effective ceiling for a resource. The tenant's own value always wins;
     * otherwise a plan-owned key falls back to the plan (NULL = unlimited) and
     * a tenant-owned key falls back to the platform default.
     */
    public static function limit(Tenant $tenant, string $key): ?int
    {
        $meta = self::REGISTRY[$key] ?? null;
        if ($meta === null) {
            return null;
        }

        $own = $tenant->limits[$key] ?? null;
        if ($own !== null && $own !== '') {
            return (int) $own;
        }

        return self::baseline($tenant, $key);
    }

    /**
     * The ceiling before anything was assigned to this shop specifically: the
     * plan's column for a billed limit, the platform default for an assigned
     * one. Shown next to the effective limit so an admin looking at "1,100" can
     * tell whether that is the plan or something they granted last month.
     */
    public static function baseline(Tenant $tenant, string $key): ?int
    {
        $meta = self::REGISTRY[$key] ?? null;
        if ($meta === null) {
            return null;
        }

        if ($meta['owner'] === 'tenant') {
            return $meta['default'];
        }

        $tenant->loadMissing('plan');
        $planLimit = $tenant->plan?->{$meta['column']};

        return $planLimit === null ? null : (int) $planLimit;
    }

    /**
     * Live usage count for a resource — the actual rows on hand right now.
     */
    public static function usage(Tenant $tenant, string $key): int
    {
        return match ($key) {
            'products' => Product::withoutTenancy()->where('tenant_id', $tenant->id)->count(),
            'staff' => $tenant->users()->where('role', UserRole::Staff)->count(),
            'orders_month' => Sale::withoutTenancy()->where('tenant_id', $tenant->id)
                ->where('created_at', '>=', now()->startOfMonth())->count(),
            'branches' => Branch::withoutTenancy()->where('tenant_id', $tenant->id)->count(),
            'registers' => Register::withoutTenancy()->where('tenant_id', $tenant->id)->count(),
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
            $meta = self::REGISTRY[$key];
            $label = $meta['label'];

            // Point at the thing that can actually be changed. A shop asking to
            // add a fourth branch is not helped by "upgrade your plan" when
            // branches were never on a plan to begin with.
            $remedy = $meta['owner'] === 'plan'
                ? 'Upgrade your plan or ask support to extend this limit to add more.'
                : "Ask support to raise the {$label} allowed for your shop.";

            throw DomainException::unprocessable(
                "You've reached your limit of {$limit} {$label}. {$remedy}",
                'LIMIT_REACHED',
            );
        }
    }

    /**
     * Full usage-vs-limit picture for a tenant — one row per limit. Powers the
     * admin's per-tenant limits panel and the shop's own usage meters.
     *
     * `baseline` and `extra` are split out deliberately: the difference between
     * "this is what the plan gives everyone" and "this is what we gave this
     * shop" is exactly what an admin needs to see before changing it.
     *
     * @return array<int, array{key:string,label:string,owner:string,limit:int|null,baseline:int|null,extra:int|null,assigned:bool,used:int,remaining:int|null,unlimited:bool,enforced:bool}>
     */
    public static function snapshot(Tenant $tenant): array
    {
        $tenant->loadMissing('plan');
        $own = $tenant->limits ?? [];

        return collect(self::REGISTRY)->map(function (array $meta, string $key) use ($tenant, $own): array {
            $limit = self::limit($tenant, $key);
            $baseline = self::baseline($tenant, $key);
            $used = self::usage($tenant, $key);

            return [
                'key' => $key,
                'label' => $meta['label'],
                'owner' => $meta['owner'],
                'limit' => $limit,
                'baseline' => $baseline,
                // Null when either side is unlimited — there is no difference to
                // state between a number and "no ceiling".
                'extra' => ($limit === null || $baseline === null) ? null : $limit - $baseline,
                // Set on this shop specifically rather than inherited.
                'assigned' => array_key_exists($key, $own) && $own[$key] !== null,
                'used' => $used,
                'remaining' => $limit === null ? null : max(0, $limit - $used),
                'unlimited' => $limit === null,
                'enforced' => $meta['enforced'],
            ];
        })->values()->all();
    }
}
