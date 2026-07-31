<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A named, reusable tax rate (see the tax_groups migration). Products point at
 * a group instead of carrying a raw percent — edit the rate once and every
 * product on it re-rates.
 */
class TaxGroup extends BaseModel
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'rate' => 'decimal:2',
            'is_active' => 'boolean',
        ];
    }

    public function products(): HasMany
    {
        return $this->hasMany(Product::class);
    }
}
