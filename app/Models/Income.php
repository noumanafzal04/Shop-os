<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Income extends BaseModel
{
    use BelongsToTenant;

    /** How the money arrived. Only `cash` touches a drawer. */
    public const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'other'];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'income_date' => 'date',
        ];
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(IncomeCategory::class, 'income_category_id')->withTrashed();
    }

    public function cashMovement(): BelongsTo
    {
        return $this->belongsTo(CashMovement::class, 'cash_movement_id');
    }

    /** See Expense::isSettledInAClosedShift() — same rule, opposite direction. */
    public function isSettledInAClosedShift(): bool
    {
        if ($this->cash_movement_id === null) {
            return false;
        }

        return CashMovement::query()
            ->whereKey($this->cash_movement_id)
            ->whereHas('session', fn ($q) => $q->where('status', '!=', 'open'))
            ->exists();
    }
}
