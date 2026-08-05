<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * The forecourt between two sets of readings.
 *
 * Not the cashier's cash_session — that is one person at one drawer, and three
 * of them come and go inside a single forecourt shift on a busy pump. This is
 * the physical period the meters and the dips both bracket.
 */
class ForecourtShift extends BaseModel
{
    use Auditable, BelongsToTenant;

    public const STATUS_OPEN = 'open';

    public const STATUS_CLOSED = 'closed';

    protected function casts(): array
    {
        return [
            'opened_at' => 'datetime',
            'closed_at' => 'datetime',
            'litres_sold' => 'decimal:3',
            'test_litres' => 'decimal:3',
            'fuel_value' => 'decimal:2',
            'pos_fuel_value' => 'decimal:2',
            'pos_fuel_litres' => 'decimal:3',
            'unbilled_litres' => 'decimal:3',
            'unbilled_value' => 'decimal:2',
            'tank_variance_litres' => 'decimal:3',
            'tank_variance_value' => 'decimal:2',
            'price_changed_during' => 'boolean',
        ];
    }

    public function readings(): HasMany
    {
        return $this->hasMany(ForecourtReading::class);
    }

    public function dips(): HasMany
    {
        return $this->hasMany(ForecourtDip::class);
    }

    public function deliveries(): HasMany
    {
        return $this->hasMany(FuelDelivery::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function openedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'opened_by');
    }

    public function closedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'closed_by');
    }

    public function isOpen(): bool
    {
        return $this->status === self::STATUS_OPEN;
    }
}
