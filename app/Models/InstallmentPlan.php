<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use App\Support\InstallmentSchedule;
use App\Support\ShopDay;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Goods that went home on installments (F1) — the terms, and where they stand.
 *
 * The debt itself lives on the customer's khata, as the charge of the sale that
 * sent the goods out (and the installment charge, when there is a markup).
 * Every installment is a khata payment written against that same sale, so the
 * khata, a return of the goods and this plan all read one set of rows.
 */
class InstallmentPlan extends BaseModel
{
    use BelongsToTenant;

    public const STATUS_RUNNING = 'running';

    public const STATUS_PAID_OFF = 'paid_off';

    /** The goods came back, or the sale was cancelled — nothing more is due. */
    public const STATUS_CLOSED = 'closed';

    /** "Due this week" — the next month's date is within this many days. */
    public const SOON_DAYS = InstallmentSchedule::SOON_DAYS;

    protected function casts(): array
    {
        return [
            'cash_price' => 'decimal:2',
            'markup_percent' => 'decimal:2',
            'markup' => 'decimal:2',
            'total' => 'decimal:2',
            'advance' => 'decimal:2',
            'financed' => 'decimal:2',
            'months' => 'integer',
            'monthly' => 'decimal:2',
            'last_month' => 'decimal:2',
            'first_due_on' => 'date:Y-m-d',
            'paid' => 'decimal:2',
            'next_due_on' => 'date:Y-m-d',
            'paid_off_at' => 'datetime',
        ];
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }

    /**
     * What has come off the plan's debt: every installment, and a return or a
     * cancellation of its sale — all khata payments against its sale.
     */
    public function payments(): HasMany
    {
        return $this->hasMany(CustomerLedgerEntry::class, 'sale_id', 'sale_id')->where('type', 'payment');
    }

    public function isRunning(): bool
    {
        return $this->status === self::STATUS_RUNNING;
    }

    /** Month by month, on the shop's calendar today. */
    public function schedule(?string $today = null): array
    {
        return InstallmentSchedule::standing(
            $this->first_due_on,
            (int) $this->months,
            (float) $this->monthly,
            (float) $this->last_month,
            (float) $this->paid,
            $today ?? ShopDay::calendarToday(),
        );
    }

    /**
     * Re-read what has been paid and write down where the plan stands — after
     * every installment, return or cancellation. The lists filter on `paid`
     * and `next_due_on`; the schedule itself is never stored.
     */
    public function refreshStanding(): void
    {
        $paid = round((float) $this->payments()->sum('amount'), 2);
        $this->paid = $paid;
        $standing = $this->schedule();
        $this->next_due_on = $standing['next_due_on'];

        if ($standing['left'] <= 0.0 && $this->status === self::STATUS_RUNNING) {
            $closed = $this->paidOffByReturn();
            $this->status = $closed ? self::STATUS_CLOSED : self::STATUS_PAID_OFF;
            $this->paid_off_at = now();
            $this->next_due_on = null;

            // The goods came back or the sale was voided: the khata reversal
            // has let the customer off the installment charge too, so it is
            // no longer the shop's income — or Reports would count a profit
            // nobody will ever pay.
            if ($closed && (float) $this->markup > 0) {
                Income::withoutTenancy()->where('tenant_id', $this->tenant_id)
                    ->where('reference', $this->number)
                    ->where('description', "Installment charge · {$this->number}")
                    ->delete();
            }
        }

        $this->save();
    }

    /** Cleared by the goods coming back (or the sale cancelled), not by paying. */
    private function paidOffByReturn(): bool
    {
        return $this->payments()->whereIn('method', Customer::NOT_COLLECTIONS)->exists();
    }

    public function scopeRunning(Builder $query): void
    {
        $query->where('status', self::STATUS_RUNNING);
    }

    /** Running, and a month's date has passed unpaid. */
    public function scopeLate(Builder $query, ?string $today = null): void
    {
        $query->running()->whereNotNull('next_due_on')->whereDate('next_due_on', '<', $today ?? ShopDay::calendarToday());
    }

    /**
     * What is still to come in this calendar month: every month falling due
     * from `$today` to the month's end, less what is paid on it. What fell due
     * before today is late, and counted there, never here too — so "late" and
     * "due this month" add up to what should be in by the month's end.
     */
    public function owedThisMonth(?string $today = null): float
    {
        $today ??= ShopDay::calendarToday();
        $end = CarbonImmutable::parse($today)->endOfMonth()->toDateString();
        $owed = 0.0;
        foreach ($this->schedule($today)['rows'] as $row) {
            if ($row['due_on'] >= $today && $row['due_on'] <= $end) {
                $owed += $row['amount'] - $row['paid'];
            }
        }

        return round($owed, 2);
    }

    /**
     * Running, with something still to come this month (owedThisMonth) — the
     * plans behind the "Due this month" figure, asked by the same rule. The
     * months are worked out, never stored, so the plans that could owe this
     * month are narrowed in SQL and finished here.
     */
    public function scopeDueThisMonth(Builder $query, ?string $today = null): void
    {
        $today ??= ShopDay::calendarToday();
        $ids = static::query()->running()
            ->whereDate('first_due_on', '<=', CarbonImmutable::parse($today)->endOfMonth()->toDateString())
            ->get()
            ->filter(fn (self $plan) => $plan->owedThisMonth($today) > 0)
            ->modelKeys();

        $query->whereKey($ids);
    }

    /** Running, not late, and the next month is due within SOON_DAYS. */
    public function scopeDueSoon(Builder $query, ?string $today = null): void
    {
        $today ??= ShopDay::calendarToday();
        $query->running()
            ->whereDate('next_due_on', '>=', $today)
            ->whereDate('next_due_on', '<=', CarbonImmutable::parse($today)->addDays(self::SOON_DAYS)->toDateString());
    }
}
