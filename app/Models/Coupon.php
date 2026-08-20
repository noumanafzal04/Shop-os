<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;

/**
 * A discount code, and a money instrument.
 *
 * Audited whole. A coupon sits DELIBERATELY outside the discount ceiling — the
 * ceiling caps what a cashier may decide on the spot, and a coupon is a
 * decision the shop already made — so the ceiling's own audit trail says
 * nothing about it. A shop issues a handful of these, each one is money off
 * every bill that quotes it, and until now nothing recorded who made one.
 */
class Coupon extends BaseModel
{
    use Auditable;
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'value' => 'decimal:2',
            'min_spend' => 'decimal:2',
            'max_discount' => 'decimal:2',
            'usage_limit' => 'integer',
            'used_count' => 'integer',
            'starts_at' => 'datetime',
            'expires_at' => 'datetime',
            'is_active' => 'boolean',
        ];
    }
}
