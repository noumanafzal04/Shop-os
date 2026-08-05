<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One tank across one shift: what was in it, what came in, what the meters took
 * out, and what is actually down there now.
 *
 * The last subtraction is the whole reason a forecourt is run this way. Meter
 * litres tell you what went into cars; this tells you what left the GROUND.
 * When the two disagree the difference is a leak, evaporation, or a hose that
 * never crossed a meter — and none of those is an attendant problem.
 */
class ForecourtDip extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'opening_dip' => 'decimal:3',
            'closing_dip' => 'decimal:3',
            'delivered_litres' => 'decimal:3',
            'meter_litres' => 'decimal:3',
            'book_closing' => 'decimal:3',
            'variance_litres' => 'decimal:3',
            'variance_value' => 'decimal:2',
        ];
    }

    public function shift(): BelongsTo
    {
        return $this->belongsTo(ForecourtShift::class, 'forecourt_shift_id');
    }

    public function tank(): BelongsTo
    {
        return $this->belongsTo(FuelTank::class, 'fuel_tank_id')->withTrashed();
    }
}
