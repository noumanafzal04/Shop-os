<?php

namespace App\Models;

use App\Enums\TenantStatus;
use App\Models\Concerns\Auditable;
use Database\Factories\TenantFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

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
            'limit_overrides' => 'array',
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

        $graceDays = $this->plan?->grace_period_days ?? 7;
        $graceEndsAt = $this->subscription_ends_at->addDays($graceDays);

        return $graceEndsAt->isFuture() ? 'grace' : 'read_only';
    }

    public function graceEndsAt(): ?\Illuminate\Support\Carbon
    {
        if ($this->subscription_ends_at === null) {
            return null;
        }

        return $this->subscription_ends_at->addDays($this->plan?->grace_period_days ?? 7);
    }

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
     * Business-type aware capability check. Effective = the tenant's feature
     * map (seeded from the business-type matrix, adjustable later). Online
     * capabilities additionally require the plan flag — see sellsOnline().
     */
    public function featureEnabled(string $feature): bool
    {
        return (bool) ($this->features[$feature] ?? false);
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
    public function localNow(): \Illuminate\Support\Carbon
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
        return array_merge(\App\Support\ShopSettings::defaults(), $this->settings ?? []);
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
