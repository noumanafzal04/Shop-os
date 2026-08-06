<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A tanker discharged into a tank.
 *
 * Recorded twice on purpose: what the invoice claims, and what the dip either
 * side of the discharge actually says arrived. Those two disagree often enough
 * — temperature, a short load, a hose left part-full — that a station which
 * only records the invoice is paying for litres it never received and has no
 * way to prove it.
 */
class FuelDelivery extends BaseModel
{
    use Auditable, BelongsToTenant;

    protected function casts(): array
    {
        return [
            'invoiced_litres' => 'decimal:3',
            'dip_before' => 'decimal:3',
            'dip_after' => 'decimal:3',
            'received_litres' => 'decimal:3',
            'shortage_litres' => 'decimal:3',
            'unit_cost' => 'decimal:3',
            'total_cost' => 'decimal:2',
            'received_at' => 'datetime',
        ];
    }

    public function tank(): BelongsTo
    {
        return $this->belongsTo(FuelTank::class, 'fuel_tank_id')->withTrashed();
    }

    public function shift(): BelongsTo
    {
        return $this->belongsTo(ForecourtShift::class, 'forecourt_shift_id');
    }

    public function supplier(): BelongsTo
    {
        return $this->belongsTo(Supplier::class)->withTrashed();
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function receivedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'received_by');
    }
}
