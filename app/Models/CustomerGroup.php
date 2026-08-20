<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A tiered-pricing segment (see the customer_groups migration). Pins a default
 * price level for members and/or an automatic members' discount percent, both
 * applied server-side at checkout.
 *
 * Audited whole. One edit here changes the price for every member at once —
 * the discount is applied server-side at checkout and nobody at the counter
 * sees it happen — and there are a handful of these per shop, so recording
 * the lot costs nothing and answers "who made the wholesale tier 20%".
 */
class CustomerGroup extends BaseModel
{
    use Auditable;
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'discount_percent' => 'decimal:2',
            'is_active' => 'boolean',
        ];
    }

    public function customers(): HasMany
    {
        return $this->hasMany(Customer::class);
    }
}
