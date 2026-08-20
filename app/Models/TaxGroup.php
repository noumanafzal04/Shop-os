<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A named, reusable tax rate (see the tax_groups migration). Products point at
 * a group instead of carrying a raw percent — edit the rate once and every
 * product on it re-rates.
 *
 * Audited whole, and it is the sharpest case in the trail: the line above is
 * the reason. One edit re-rates every product on the group, quietly, and the
 * difference between the old rate and the new one is money owed to FBR. A
 * shop asked to justify a return needs to be able to say who changed it and
 * when — there are a few of these per shop, so the log costs nothing.
 */
class TaxGroup extends BaseModel
{
    use Auditable;
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
