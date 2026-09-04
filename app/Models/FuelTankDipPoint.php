<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One line of a tank's calibration chart: at this depth, this many litres.
 *
 * Deliberately dumb. A chart is a MEASUREMENT of a particular tank, made by
 * whoever certified it, and nothing here is entitled to an opinion about the
 * shape of it — an underground cylinder, a rectangular bowser and a vertical
 * silo all produce different curves, and half a chart is often a manufacturer's
 * table the station has had for twenty years.
 *
 * Not `Auditable`: a chart is replaced whole (see FuelSetupController) and a
 * per-row audit trail of two thousand points would say nothing a
 * "chart replaced" entry does not.
 */
class FuelTankDipPoint extends BaseModel
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'mm' => 'integer',
            'litres' => 'decimal:3',
        ];
    }

    public function tank(): BelongsTo
    {
        return $this->belongsTo(FuelTank::class, 'fuel_tank_id');
    }
}
