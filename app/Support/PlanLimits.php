<?php

namespace App\Support;

use App\Enums\UserRole;
use App\Exceptions\DomainException;
use App\Models\Branch;
use App\Models\PosDevice;
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
     *   kind     'count' (default) = a number of rows the shop owns
     *            'policy'          = a rule about behaviour, not a possession
     * ]
     *
     * `kind` exists because one guard elsewhere is only true of countable
     * things. An admin may never set a ceiling BELOW live usage — cutting a
     * 800-product shop to 100 blocks every new product with no error and looks
     * like broken software days later. That reasoning does not carry to a
     * policy: tightening the offline window while a tablet is five days out is
     * not a typo, it is the exact thing an owner does when a tablet goes
     * missing, and refusing it would be refusing the remedy.
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
        // How long a till may keep SELLING with no contact with the server.
        //
        // Not enforced through assert(): nothing is being created, so there is
        // no write to refuse. The till reads this ceiling and degrades against
        // it. What `usage` reports is the worst device currently out of
        // contact, which is the number an admin actually wants beside the
        // policy — "you allow 3 days, and one of their tablets is at 5".
        //
        // It limits SELLING, never SYNCING: the queue of unsent sales has no
        // expiry at all, and a sale rung forty days ago still syncs and is
        // still accepted. Expiring the queue along with the selling window is
        // how offline systems lose money.
        'offline_days' => ['owner' => 'tenant', 'default' => 3, 'label' => 'days offline', 'enforced' => false, 'kind' => 'policy'],
        // May this shop's tills SELL with no server at all?
        //
        // The kill switch, and the reason it is a separate key rather than
        // `offline_days => 0`: the window does not stop selling, it marks it.
        // A shop set to zero days would carry on trading and simply flag every
        // sale, which is the opposite of a switch.
        //
        // 0 = off, 1 = on. A limit rather than a setting because the shop must
        // not be able to turn it on for itself: `tenants.settings` is written
        // through the shop's own form, and this is the admin's decision about
        // whether this particular shop has earned it — the same axis as
        // branches and staff, set on the same screen.
        //
        // OFF DOES NOT MEAN "REJECT WHAT IS ALREADY QUEUED." Turning it off
        // stops NEW offline sales; a sale already rung on a tablet syncs and is
        // accepted, for ever, exactly as before. The money crossed the counter
        // and no switch can un-cross it — see `PosSyncController`.
        //
        // Defaults to 0. A shop gets offline selling when an admin decides it
        // does, after shadow mode has actually proved the pricing mirror on
        // that shop's own carts.
        'offline_selling' => ['owner' => 'tenant', 'default' => 0, 'label' => 'offline selling (0 = off, 1 = on)', 'enforced' => false, 'kind' => 'policy'],
        // The point past which a till stops trading blind altogether.
        //
        // `offline_days` MARKS; this REFUSES, and the two are deliberately
        // different tools. A shop that trades through a week-long outage and
        // flags every sale still has a week of prices, stock and promotions
        // decided by a catalog nobody has updated — at some depth the flag
        // stops being information and the shop is simply guessing.
        //
        // OPT-IN, and 0 means NEVER STOP. Nothing changes for anybody until an
        // owner asks for a ceiling: a non-zero default here would be this file
        // deciding, on behalf of a shop it knows nothing about, that a fourth
        // day without internet is worse than turning customers away — and in
        // most of Pakistan it is not. The shops that want it are the ones with
        // something to lose.
        //
        // 0 rather than null because a TENANT-OWNED limit is never unlimited —
        // an unset one falls to the platform default, which is the rule the
        // whole usage screen is built on (see the note at the top of this
        // file). `offline_selling` spends 0 the same way, for the same reason.
        //
        // ── What "refused" is careful NOT to mean ──────────────────────
        //
        // Not the cart in the cashier's hand. The goods are on the counter and
        // the customer is standing there; a stop that lands mid-transaction is
        // the exact failure offline selling exists to prevent. The ceiling is
        // judged when a cart is STARTED, so what is already open finishes.
        //
        // Not the queue, either. Sales already rung sync for ever, like every
        // other offline rule here — see `offline_selling`.
        'offline_hard_stop_days' => ['owner' => 'tenant', 'default' => 0, 'label' => 'hard stop after N days offline (0 = never)', 'enforced' => false, 'kind' => 'policy'],
    ];

    /** Is this a number of rows the shop owns, rather than a rule about behaviour? */
    public static function isCountable(string $key): bool
    {
        return (self::REGISTRY[$key]['kind'] ?? 'count') === 'count';
    }

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
            // Not a count of anything owned — the WORST device currently out of
            // contact, in whole days. Zero when every till is in touch, which
            // is the normal reading. Revoked devices are excluded: a tablet
            // that was stopped on purpose is not an outstanding one.
            'offline_days' => (int) PosDevice::withoutTenancy()
                ->where('tenant_id', $tenant->id)
                ->live()
                ->get(['last_seen_at'])
                ->map(fn (PosDevice $d): int => $d->daysOffline())
                ->max() ?? 0,
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
