<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

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

    /**
     * The schedule this was posted from, when it wasn't typed by hand.
     *
     * PostRecurringExpenseAction has always stamped the id and nothing ever
     * read it back, so "why is there a second rent entry this month?" was a
     * question the books could not answer about their own rows. Null means
     * somebody entered it themselves, which is the answer just as often.
     */
    public function recurringExpense(): BelongsTo
    {
        return $this->belongsTo(RecurringExpense::class);
    }

    /**
     * Where to fetch the receipt, not a link anyone can follow.
     *
     * This used to be a public storage URL — no token, no tenant check, one
     * guessable path away from another business's bills. It is now the API
     * endpoint, which runs the same permission and tenant scope as the row.
     * The client must fetch it with its bearer token (see the panel's
     * openAuthedFile) rather than dropping it into an href.
     */
    protected function attachmentUrl(): Attribute
    {
        return Attribute::get(
            fn (): ?string => $this->attachment_path
                ? "/expenses/{$this->id}/attachment"
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
