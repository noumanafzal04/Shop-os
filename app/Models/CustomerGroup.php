<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A tiered-pricing segment (see the customer_groups migration). Pins a default
 * price level for members and/or an automatic members' discount percent, both
 * applied server-side at checkout.
 */
class CustomerGroup extends BaseModel
{
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
