<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One underground tank. Holds a product, feeds nozzles, and carries the last
 * dip taken — which is the number the next shift opens on.
 */
class FuelTank extends BaseModel
{
    use Auditable, BelongsToTenant;

    protected function casts(): array
    {
        return [
            'capacity_litres' => 'decimal:3',
            'current_dip_litres' => 'decimal:3',
            'dead_stock_litres' => 'decimal:3',
            'is_active' => 'boolean',
        ];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class)->withTrashed();
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function nozzles(): HasMany
    {
        return $this->hasMany(FuelNozzle::class);
    }

    /**
     * What can actually be sold: the dip, less the unpumpable bottom. A tank
     * reading 900 litres with 800 of dead stock has 100 to sell, and a
     * forecourt manager ordering against the raw dip runs dry.
     */
    public function sellableLitres(): float
    {
        return max(0, round((float) $this->current_dip_litres - (float) $this->dead_stock_litres, 3));
    }

    /** Room left for a delivery — a tanker that won't fit has to be turned away. */
    public function ullageLitres(): float
    {
        return max(0, round((float) $this->capacity_litres - (float) $this->current_dip_litres, 3));
    }
}
