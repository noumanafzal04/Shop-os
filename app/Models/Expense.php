<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Storage;

class Expense extends BaseModel
{
    use BelongsToTenant;

    /** How the money left. Only `cash` touches a drawer. */
    public const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'credit', 'other'];

    protected $appends = ['attachment_url'];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'expense_date' => 'date',
        ];
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(ExpenseCategory::class, 'expense_category_id')->withTrashed();
    }

    public function supplier(): BelongsTo
    {
        return $this->belongsTo(Supplier::class)->withTrashed();
    }

    /** The receipt photo, ready to open. Null when none was attached. */
    protected function attachmentUrl(): Attribute
    {
        return Attribute::get(
            fn (): ?string => $this->attachment_path
                ? Storage::disk('public')->url($this->attachment_path)
                : null,
        );
    }

    /** The drawer movement this expense created, when it was paid in cash. */
    public function cashMovement(): BelongsTo
    {
        return $this->belongsTo(CashMovement::class, 'cash_movement_id');
    }

    /**
     * Cash that has left a drawer whose shift is already counted and closed.
     *
     * Editing the amount now would rewrite a variance somebody signed off, and
     * deleting it would leave the shift short with no record of why. The entry
     * is frozen; a mistake is corrected with a compensating entry, the way a
     * cash book has always worked.
     */
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
