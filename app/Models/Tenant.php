<?php

namespace App\Models;

use App\Enums\TenantStatus;
use App\Models\Concerns\Auditable;
use App\Support\Modules;
use App\Support\ShopSettings;
use Database\Factories\TenantFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

class Tenant extends BaseModel
{
    use Auditable;

    /** @use HasFactory<TenantFactory> */
    use HasFactory;

    protected $table = 'tenants';

    protected static function booted(): void
    {
        // Every tenant always has exactly one default "Main" branch — created
        // silently the moment the tenant exists, via any path (admin action,
        // seeder, factory). This upholds the "a tenant has ≥1 branch" invariant
        // so a single-shop owner never has to think about branches.
        static::created(function (Tenant $tenant): void {
            $tenant->branches()->create([
                'name' => 'Main',
                'code' => 'MAIN',
                'is_default' => true,
                'is_active' => true,
            ]);
        });
    }

    protected function casts(): array
    {
        return [
            'status' => TenantStatus::class,
            'online_shop_enabled' => 'boolean',
            'delivery_fee' => 'decimal:2',
            'features' => 'array',
            'limits' => 'array',
            'setup_completed' => 'boolean',
            'subscription_starts_at' => 'datetime',
            'subscription_ends_at' => 'datetime',
            'business_hours' => 'array',
            'settings' => 'array',
            'latitude' => 'decimal:7',
            'longitude' => 'decimal:7',
        ];
    }

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class);
    }

    public function plan(): BelongsTo
    {
        return $this->belongsTo(Plan::class);
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public function branches(): HasMany
    {
        return $this->hasMany(Branch::class);
    }

    public function reviews(): HasMany
    {
        return $this->hasMany(Review::class);
    }

    public function isActive(): bool
    {
        return $this->status === TenantStatus::Active;
    }

    public function isSuspended(): bool
    {
        return $this->status === TenantStatus::Suspended;
    }

    /**
     * Subscription expired past its end date.
     */
    public function subscriptionExpired(): bool
    {
        return $this->subscription_ends_at !== null
            && $this->subscription_ends_at->isPast();
    }

    /**
     * Grace for a tenant whose plan does not state one. Plans are required at
     * creation, so in practice this covers rows written before that rule
     * existed — and those are exactly the rows an admin most needs to find.
     */
    public const DEFAULT_GRACE_DAYS = 7;

    /** The days of grace this shop actually gets. */
    public function graceDays(): int
    {
        return (int) ($this->plan?->grace_period_days ?? self::DEFAULT_GRACE_DAYS);
    }

    /**
     * Subscription lifecycle:
     *   active    → within the paid window (or no window set — e.g. free core)
     *   grace     → past end date but within the plan's grace period; full
     *               access, loud warnings
     *   read_only → grace exhausted; reads work, writes are blocked. Data is
     *               NEVER deleted — renewal restores everything instantly.
     */
    public function subscriptionState(): string
    {
        if (! $this->subscriptionExpired()) {
            return 'active';
        }

        return $this->graceEndsAt()->isFuture() ? 'grace' : 'read_only';
    }

    public function graceEndsAt(): ?Carbon
    {
        if ($this->subscription_ends_at === null) {
            return null;
        }

        // copy(): Illuminate's Carbon is mutable, and this used to be called
        // twice in a row on the same instance.
        return $this->subscription_ends_at->copy()->addDays($this->graceDays());
    }

    /**
     * The same lifecycle in the words an admin uses when chasing money, which
     * are not the words the enforcement middleware uses.
     *
     * `read_only` describes what the SOFTWARE does; "unpaid" describes why. And
     * suspension is a platform decision that outranks the calendar entirely — a
     * suspended shop is off whether or not its month is paid, so it is one
     * bucket and never appears in the other three. That exclusivity is the
     * whole point: four filters that overlap cannot be counted.
     */
    public function paymentStatus(): string
    {
        if ($this->isSuspended()) {
            return 'suspended';
        }

        return match ($this->subscriptionState()) {
            'active' => 'paid',
            'grace' => 'grace',
            default => 'unpaid',
        };
    }

    /**
     * paymentStatus() as a query, so a list of 4,000 shops can be filtered by
     * the database rather than loaded and sifted in PHP.
     *
     * The awkward part is grace, which varies per plan and so wants
     * `ends_at + plan.grace_days >= now` — date arithmetic that is written
     * differently on every driver (this codebase runs MySQL live and SQLite in
     * tests). Rearranging the same inequality moves the arithmetic to PHP:
     *
     *     ends_at + graceDays > now   ⟺   ends_at > now - graceDays
     *
     * so nothing crosses into SQL but a timestamp. Plans is a table of a
     * handful of rows, so one branch per plan is cheaper than a join and
     * exactly matches what subscriptionState() computes for a single row.
     */
    public function scopePaymentStatus($query, string $status)
    {
        // The list is asked for `with_deleted` so an admin can restore a
        // business, but a deleted business owes nothing and must never turn up
        // on a chase list. Explicit because the caller has already lifted the
        // soft-delete scope by the time this runs.
        $query->whereNull('deleted_at');

        if ($status === 'suspended') {
            return $query->where('status', TenantStatus::Suspended);
        }

        $query->where('status', '!=', TenantStatus::Suspended);

        if ($status === 'paid') {
            // No end date = nothing is owed. A shop cannot be behind on a bill
            // it was never given.
            return $query->where(fn ($q) => $q
                ->whereNull('subscription_ends_at')
                ->orWhere('subscription_ends_at', '>=', now()));
        }

        // Both remaining buckets are past the end date; grace is what separates
        // them. `>` for grace and `<=` for unpaid mirrors graceEndsAt()->isFuture().
        $operator = $status === 'grace' ? '>' : '<=';

        $graceByPlan = Plan::query()->pluck('grace_period_days', 'id');

        return $query
            ->whereNotNull('subscription_ends_at')
            ->where('subscription_ends_at', '<', now())
            ->where(function ($q) use ($graceByPlan, $operator): void {
                foreach ($graceByPlan as $planId => $days) {
                    $cutoff = now()->subDays((int) ($days ?? self::DEFAULT_GRACE_DAYS));
                    $q->orWhere(fn ($w) => $w
                        ->where('plan_id', $planId)
                        ->where('subscription_ends_at', $operator, $cutoff));
                }

                $q->orWhere(fn ($w) => $w
                    ->whereNull('plan_id')
                    ->where('subscription_ends_at', $operator, now()->subDays(self::DEFAULT_GRACE_DAYS)));
            });
    }

    /** The four buckets, in the order an admin reads them. */
    public const PAYMENT_STATUSES = ['paid', 'grace', 'unpaid', 'suspended'];

    /**
     * Whether this tenant participates in the marketplace / online selling.
     * Expense-Manager-only tenants are never visible online.
     */
    public function sellsOnline(): bool
    {
        return $this->online_shop_enabled
            && $this->isActive()
            && $this->featureEnabled('marketplace');
    }

    /**
     * Capability check. The tenant's own module map is the only authority —
     * proposed by its business type when it was created, adjusted by an admin,
     * and never rewritten by a billing event.
     */
    public function featureEnabled(string $feature): bool
    {
        return (bool) ($this->features[$feature] ?? false);
    }

    /**
     * The whole map, for the few callers that must reason about several flags
     * at once rather than ask about one — BusinessTypes::itemTypesFor, which
     * needs to know both what this shop stocks AND what it bills.
     *
     * Never null: a half-provisioned tenant reads as every module off, which is
     * the same fail-closed answer featureEnabled() gives.
     *
     * @return array<string, bool>
     */
    public function moduleMap(): array
    {
        return $this->features ?? [];
    }

    /**
     * The ONE way a tenant's modules are ever written.
     *
     * `online_shop_enabled` is a denormalised copy of the Online Store module —
     * it exists because the marketplace listing query runs on every shopper's
     * homepage and an indexed boolean beats a JSON lookup. Keeping the two in
     * step is exactly the kind of thing that gets forgotten in one of three
     * call sites, and when it was, ticking Online Store did nothing at all:
     * sellsOnline() wants both, so the module went on and the shop stayed
     * invisible. Writing them together, here, is the fix.
     *
     * @param  array<string, mixed>  $modules  full or partial map
     * @param  bool  $merge  false replaces the map outright rather than layering
     */
    public function applyModules(array $modules, bool $merge = true): static
    {
        $features = Modules::normalize(
            $merge ? array_merge($this->features ?? [], $modules) : $modules,
        );

        $this->forceFill([
            'features' => $features,
            'online_shop_enabled' => $features['marketplace'],
        ])->save();

        return $this;
    }

    /**
     * Assign this shop's own ceilings — branches, staff, lanes, or an extension
     * past its plan on products and storage. A null value clears the assignment
     * and lets the resource fall back to its plan or platform default.
     *
     * @param  array<string, int|null>  $limits
     */
    public function assignLimits(array $limits): static
    {
        $current = $this->limits ?? [];

        foreach ($limits as $key => $value) {
            if ($value === null || $value === '') {
                unset($current[$key]);

                continue;
            }
            $current[$key] = (int) $value;
        }

        $this->forceFill(['limits' => $current ?: null])->save();

        return $this;
    }

    /**
     * Product images available? Selling online forces them on (an online
     * customer must see what they're buying); otherwise it's the admin-set
     * `images` module flag (defaulted per business type).
     */
    public function imagesEnabled(): bool
    {
        return $this->featureEnabled('images') || $this->featureEnabled('marketplace');
    }

    /**
     * Open right now per business_hours ([{day: 0-6, open: "H:i", close: "H:i"}]).
     * No hours saved → treated as always open (never block a shop that hasn't
     * configured hours). A close before its open wraps past midnight.
     */
    /**
     * "Now" in the shop's own wall-clock. Everything that compares against a
     * shop-configured time-of-day or calendar date (business hours, food
     * serving windows, coupon validity) must use this, not the UTC now().
     */
    public function localNow(): Carbon
    {
        return now()->setTimezone($this->timezone ?: 'Asia/Karachi');
    }

    public function isOpenNow(): bool
    {
        $hours = $this->business_hours;
        if (empty($hours)) {
            return true;
        }

        $now = $this->localNow();
        $today = collect($hours)->firstWhere('day', $now->dayOfWeek);
        if ($today === null || empty($today['open']) || empty($today['close'])) {
            return false; // hours configured, but closed today
        }

        $time = $now->format('H:i');
        if ($today['close'] < $today['open']) {
            return $time >= $today['open'] || $time <= $today['close'];
        }

        return $time >= $today['open'] && $time <= $today['close'];
    }

    /**
     * Order-fulfillment modes (per business): pickup-only, delivery-only,
     * or both. Pickup is a pure setting; delivery additionally requires the
     * business-type `delivery` feature (a cloud kitchen can't disable pickup
     * AND delivery — validation keeps at least one on).
     */
    public function pickupEnabled(): bool
    {
        return (bool) $this->setting('pickup_enabled', true);
    }

    public function deliveryEnabled(): bool
    {
        return $this->featureEnabled('delivery') && (bool) $this->setting('delivery_enabled', true);
    }

    /** Effective config = ShopSettings defaults merged with saved overrides. */
    public function allSettings(): array
    {
        return array_merge(ShopSettings::defaults(), $this->settings ?? []);
    }

    public function setting(string $key, mixed $default = null): mixed
    {
        return $this->allSettings()[$key] ?? $default;
    }

    /** The shop's currency symbol (settings → currency_symbol, default "Rs"). */
    public function currencySymbol(): string
    {
        return (string) $this->setting('currency_symbol', 'Rs');
    }

    /**
     * Marketplace visibility rules — every edge case in one scope:
     *  - Expense-Manager-only tenants   → never listed (plan flag)
     *  - business type without marketplace → never listed (feature flag)
     *  - suspended / deleted            → hidden
     *  - setup not completed            → hidden (no city yet)
     *  - subscription ended > 7 days ago → hidden until renewal
     */
    public function scopeMarketplaceVisible($query)
    {
        return $query
            ->where('status', TenantStatus::Active)
            ->where('online_shop_enabled', true)
            ->where('setup_completed', true)
            ->where('features->marketplace', true)
            ->where(function ($q): void {
                $q->whereNull('subscription_ends_at')
                    ->orWhere('subscription_ends_at', '>=', now()->subDays(7));
            });
    }
}
