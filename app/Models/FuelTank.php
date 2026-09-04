<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Collection;

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

    /** The calibration chart, shallowest first — see litresAtDip(). */
    public function dipPoints(): HasMany
    {
        return $this->hasMany(FuelTankDipPoint::class)->orderBy('mm');
    }

    /**
     * WHAT THE STICK SAYS, IN LITRES.
     *
     * A dipstick reads a depth. An underground cylinder on its side holds a
     * wildly different volume per millimetre at the bottom, the middle and the
     * top, so the only honest conversion is the station's own certified chart —
     * never a formula, and never a capacity divided by a height.
     *
     * Between two charted points the volume is interpolated straight, because
     * that is what a shop does reading between two lines of the printed table.
     *
     * OUTSIDE the chart it returns null rather than extrapolating. A depth the
     * chart does not cover is either a mis-read stick or the wrong chart
     * altogether, and both are worth stopping for: this number is the one the
     * whole leak detection rests on, and a confidently wrong one is worse than
     * a refusal. `null` also means "no chart", which the caller must handle the
     * same way — it cannot convert either.
     */
    public function litresAtDip(int $mm): ?float
    {
        if ($mm < 0) {
            return null;
        }

        /** @var Collection<int, FuelTankDipPoint> $points */
        $points = $this->relationLoaded('dipPoints')
            ? $this->dipPoints
            : $this->dipPoints()->get();

        if ($points->count() < 2) {
            return null;
        }

        $below = null;
        $above = null;

        foreach ($points as $point) {
            if ((int) $point->mm === $mm) {
                return round((float) $point->litres, 3);
            }

            if ((int) $point->mm < $mm) {
                $below = $point;
            } elseif ($above === null) {
                $above = $point;
            }
        }

        if ($below === null || $above === null) {
            return null;
        }

        $span = (int) $above->mm - (int) $below->mm;
        $rise = (float) $above->litres - (float) $below->litres;

        return round((float) $below->litres + ($rise * ($mm - (int) $below->mm) / $span), 3);
    }

    /**
     * Can this tank be dipped in millimetres at all?
     *
     * Appended, because two screens ask it and neither wants the chart itself:
     * the setup form draws "chart loaded" beside the tank, and the close screen
     * decides whether to offer a millimetre box. Reads `dip_points_count` where
     * the caller loaded it, so a list of tanks is one query and not one per
     * tank.
     */
    protected $appends = ['has_dip_chart'];

    public function hasDipChart(): bool
    {
        $count = $this->dip_points_count
            ?? ($this->relationLoaded('dipPoints') ? $this->dipPoints->count() : $this->dipPoints()->count());

        return (int) $count >= 2;
    }

    public function getHasDipChartAttribute(): bool
    {
        return $this->hasDipChart();
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
