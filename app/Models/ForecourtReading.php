<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One nozzle's meter across one shift. Snapshots the nozzle, pump and product
 * names so a retired hose never orphans a reconciliation somebody signed.
 */
class ForecourtReading extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'opening_reading' => 'decimal:3',
            'closing_reading' => 'decimal:3',
            'test_litres' => 'decimal:3',
            'litres_sold' => 'decimal:3',
            'unit_price' => 'decimal:2',
            'value' => 'decimal:2',
        ];
    }

    public function shift(): BelongsTo
    {
        return $this->belongsTo(ForecourtShift::class, 'forecourt_shift_id');
    }

    public function nozzle(): BelongsTo
    {
        return $this->belongsTo(FuelNozzle::class, 'fuel_nozzle_id')->withTrashed();
    }
}
