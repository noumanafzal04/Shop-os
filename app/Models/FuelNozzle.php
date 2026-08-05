<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One hose. Carries the cumulative totaliser, which is the pump's own record of
 * everything it has ever dispensed.
 */
class FuelNozzle extends BaseModel
{
    use Auditable, BelongsToTenant;

    /**
     * Mechanical heads roll over at 999999.999 and start again at zero. A shift
     * that spans the roll would otherwise compute a closing reading BELOW its
     * opening one and report the whole tank as recovered — hundreds of
     * thousands of litres of phantom gain, on the one report an owner reads to
     * find losses.
     */
    public const ROLLOVER_AT = 1000000.0;

    protected function casts(): array
    {
        return [
            'current_reading' => 'decimal:3',
            'is_active' => 'boolean',
        ];
    }

    public function pump(): BelongsTo
    {
        return $this->belongsTo(FuelPump::class, 'fuel_pump_id');
    }

    public function tank(): BelongsTo
    {
        return $this->belongsTo(FuelTank::class, 'fuel_tank_id');
    }

    /**
     * Litres between two totaliser readings, handling the roll.
     *
     * A closing reading below the opening one is only ever one of two things: a
     * meter that rolled, or a number keyed wrong. We treat it as a roll,
     * because a mis-key is caught by the tank dip a moment later while a
     * missed roll silently erases a shift.
     */
    public static function litresBetween(float $opening, float $closing): float
    {
        $delta = $closing - $opening;

        return round($delta < 0 ? $delta + self::ROLLOVER_AT : $delta, 3);
    }
}
