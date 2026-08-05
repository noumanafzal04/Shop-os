<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A register — one checkout lane / till at a branch. Large marts run several;
 * a corner shop runs none and the POS falls back to plain per-cashier shifts.
 *
 * What a register owns:
 *   - its own SHIFT (one open cash session at a time — the drawer is physical)
 *   - its own HARDWARE (receipt printer, drawer, display), falling back to the
 *     shop-wide devices when the lane has none of its own
 *   - the sales rung on it, for per-lane reporting
 */
class Register extends BaseModel
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'settings' => 'array',
        ];
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function sessions(): HasMany
    {
        return $this->hasMany(CashSession::class);
    }

    public function devices(): HasMany
    {
        return $this->hasMany(HardwareDevice::class);
    }

    /** The shift currently open on this lane, if any. */
    public function openSession(): ?CashSession
    {
        return $this->sessions()->where('status', 'open')->first();
    }

    /** "Lane 1 (L1)" for receipts and pickers. */
    public function label(): string
    {
        return $this->code ? "{$this->name} ({$this->code})" : (string) $this->name;
    }
}
