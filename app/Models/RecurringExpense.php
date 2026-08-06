<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A cost that comes round again: rent, salaries, the internet bill.
 *
 * Deliberately a template that falls DUE rather than a job that posts itself.
 * An expense that appears in the books because a clock ticked is an expense
 * nobody checked against a bill — and the amount is exactly the thing that
 * moves (electricity never bills twice the same). So the shop sees "3 due",
 * confirms the real figure, and posts.
 */
class RecurringExpense extends BaseModel
{
    use Auditable, BelongsToTenant;

    public const FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly'];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'next_due_on' => 'date',
            'last_posted_on' => 'date',
            'is_active' => 'boolean',
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

    public function isDue(): bool
    {
        return $this->is_active && $this->next_due_on !== null && ! $this->next_due_on->isFuture();
    }

    /**
     * The next date after this one.
     *
     * Advances from the DUE date, not from today, so a bill posted four days
     * late doesn't drag every future month four days later with it. A template
     * left unposted for months catches up one period at a time rather than
     * jumping to the future and skipping the ones that were missed.
     */
    public function advance(Carbon $from): Carbon
    {
        return match ($this->frequency) {
            'weekly' => $from->copy()->addWeek(),
            'quarterly' => $from->copy()->addMonthsNoOverflow(3),
            'yearly' => $from->copy()->addYearNoOverflow(),
            default => $from->copy()->addMonthNoOverflow(),
        };
    }
}
