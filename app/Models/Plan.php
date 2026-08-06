<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A plan is a PAYMENT plan: what the shop pays, how often, how long it keeps
 * working after the date passes, and how much it may hold.
 *
 * It grants no capability. Which modules a shop has, how many branches and how
 * many staff are properties of the shop itself, assigned when an admin creates
 * it — see Modules and PlanLimits. That separation is why two plans are enough:
 * a petrol pump and a restaurant can both sit on Basic and keep the forecourt
 * and the kitchen tickets they need.
 */
class Plan extends Model
{
    use HasUuids;

    protected $fillable = [
        'name',
        'code',
        'description',
        'price',
        'billing_period_months',
        'grace_period_days',
        // Billed usage ceilings — NULL means unlimited.
        'max_products',
        'max_storage_mb',
        'max_orders_month',
        'is_active',
        'is_custom',
    ];

    protected function casts(): array
    {
        return [
            'price' => 'decimal:2',
            'is_active' => 'boolean',
            'is_custom' => 'boolean',
            'max_products' => 'integer',
            'max_storage_mb' => 'integer',
            'max_orders_month' => 'integer',
        ];
    }

    public function tenants(): HasMany
    {
        return $this->hasMany(Tenant::class);
    }
}
