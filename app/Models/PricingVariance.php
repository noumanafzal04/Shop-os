<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One cart where the offline pricing engine and the server disagreed.
 *
 * Diagnostics, not accounting: nothing reads this to decide a figure. It exists
 * so that "the mirror agrees with the server" is a measurement taken on real
 * carts rather than a claim made about imagined ones.
 */
class PricingVariance extends Model
{
    use BelongsToTenant;
    use HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'found_at' => 'datetime',
            'server_totals' => 'array',
            'local_totals' => 'array',
            'differences' => 'array',
            'cart' => 'array',
        ];
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(PosDevice::class, 'device_id');
    }

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }
}
