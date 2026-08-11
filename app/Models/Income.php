<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Income extends BaseModel
{
    use BelongsToTenant;

    /** How the money arrived. Only `cash` touches a drawer. */
    public const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'other'];

    protected $appends = ['attachment_url'];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'income_date' => 'date',
        ];
    }

    /**
     * The proof this money came in. Same rule as Expense, opposite direction —
     * the column was added alongside the expense one and then never wired to
     * anything, so income was the only side of the book that could not be
     * evidenced. An owner questioning a Rs 80,000 "owner investment" had
     * nothing to open.
     */
    /** The API endpoint, not a public link — see Expense::attachmentUrl. */
    protected function attachmentUrl(): Attribute
    {
        return Attribute::get(
            fn (): ?string => $this->attachment_path
                ? "/incomes/{$this->id}/attachment"
                : null,
        );
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
