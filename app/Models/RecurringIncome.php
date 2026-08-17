<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Money that comes round again: the flat upstairs, the shutter let to the
 * phone-repair man, a monthly supply contract, a fixed commission.
 *
 * The exact twin of RecurringExpense, on purpose. It is the same problem seen
 * from the other side of the page, and two screens doing one job in two
 * vocabularies is how one of them ends up half-maintained.
 *
 * Deliberately a template that falls DUE rather than a job that posts itself.
 * Income that appears in the books because a clock ticked is income nobody
 * checked against a payment — and rent is exactly the thing that goes unpaid
 * quietly. The shop sees "2 due", confirms what actually arrived, and posts.
 */
class RecurringIncome extends BaseModel
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
        return $this->belongsTo(IncomeCategory::class, 'income_category_id')->withTrashed();
    }

    public function isDue(): bool
    {
        return $this->is_active && $this->next_due_on !== null && ! $this->next_due_on->isFuture();
    }

    /**
     * The next date after this one.
     *
     * Advances from the DUE date, not from today, so rent collected four days
     * late does not drag every future month four days later with it. A template
     * left unposted for three months catches up one period at a time — each of
     * those months genuinely had rent owing, and jumping to the future would
     * erase two of them.
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
