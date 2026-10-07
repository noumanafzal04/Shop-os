<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;
use App\Support\ShopDay;
use App\Support\TenantContext;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * A shop's trading day.
 *
 * Not a shift. A shift is one person at one drawer; a day is three of them plus
 * the safe, and the question an owner actually asks — "what did we take, and
 * how much went to the bank?" — cannot be answered by any single shift.
 *
 * Closing freezes the roll-up. A day signed off in March has to read the same
 * in September, whatever has happened to a linked sale since.
 */
class BusinessDay extends Model
{
    use Auditable, BelongsToTenant, HasUuids;

    public const STATUS_OPEN = 'open';

    public const STATUS_CLOSED = 'closed';

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'trading_date' => 'date',
            'opened_at' => 'datetime',
            'closed_at' => 'datetime',
            'reopened_at' => 'datetime',
            'shifts_count' => 'integer',
            'opening_float' => 'decimal:2',
            'cash_sales' => 'decimal:2',
            'cash_in' => 'decimal:2',
            'cash_out' => 'decimal:2',
            'expected_cash' => 'decimal:2',
            'counted_cash' => 'decimal:2',
            'variance' => 'decimal:2',
            'sales_count' => 'integer',
            'sales_total' => 'decimal:2',
            'banked_amount' => 'decimal:2',
            'tender_mix' => 'array',
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

    public function deposits(): HasMany
    {
        return $this->hasMany(BankDeposit::class);
    }

    public function openedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'opened_by');
    }

    public function closedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'closed_by');
    }

    public function reopenedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reopened_by');
    }

    /**
     * The day this counter is trading — the ONE answer to that question.
     *
     * It was asked in three places and answered three ways. `open()` keys on
     * branch + today's date, which is what a day actually is. The screen took
     * the open day with the latest trading date. And recording a bank deposit
     * took an open day with **no ordering at all**, so the database handed back
     * whichever it liked.
     *
     * On a counter with one open day nobody could tell the difference. On a
     * shop that forgot to close last night — an ordinary Monday morning — there
     * are two, and the deposit landed on YESTERDAY: the banking column on
     * today's screen never moved, and yesterday's day was eventually closed off
     * carrying money that was never in it.
     *
     * Ordering by trading date is not a tie-break here. It is the definition:
     * of the days still open at this counter, the shop is trading the newest.
     */
    public static function openFor(?string $branchId): ?self
    {
        return static::query()
            ->where('status', self::STATUS_OPEN)
            ->where('branch_id', $branchId)
            ->latest('trading_date')
            ->first();
    }

    /**
     * EVERY COUNTER THAT IS TRADING, NEWEST FIRST.
     *
     * `openFor(null)` cannot answer this and must not try: it would look for
     * a day whose `branch_id` IS NULL, which is no day at all. "All branches"
     * is not a branch — it is a question about several, and the owner's HQ
     * view is the one place that question is asked.
     *
     * Newest first for the same reason `openFor` orders that way: of the days
     * still open, the one being traded is the latest.
     *
     * @return Collection<int, self>
     */
    public static function openAcrossTheShop(): Collection
    {
        return static::query()
            ->where('status', self::STATUS_OPEN)
            ->whereNotNull('branch_id')
            ->latest('trading_date')
            ->get();
    }

    /**
     * THE DATE A MOMENT TRADES UNDER, AT THIS COUNTER.
     *
     * The shop's business date (ShopDay) — a shift opened at one in the
     * morning belongs to the evening it is part of, so the day the till
     * closes off is the same day the reports call by that date.
     *
     * With one exception, and it is the difference between a restaurant and
     * a petrol station. A day that has been CLOSED OFF is over: somebody
     * counted it and signed it. Whatever is rung after that, once the
     * calendar has moved on, is the next day's — or a forecourt that closes
     * its day at midnight could sell nothing until five.
     *
     *     01:00, yesterday's day still open    → yesterday  (the evening goes on)
     *     01:00, yesterday's day closed at 00:05 → today    (a new day has begun)
     *     15:00, today's day closed at 14:00    → today, and it is closed —
     *                                             which is a refusal, and a
     *                                             reopen if it was a mistake
     *
     * Asked by the shift that is opening NOW and by a sale arriving late from
     * an offline till, so the two cannot disagree about whose day a sale was.
     */
    public static function tradingDateAt(?string $branchId, DateTimeInterface $moment, ?Tenant $tenant = null): string
    {
        $tenant ??= app(TenantContext::class)->get();

        $business = ShopDay::dateOf($moment, $tenant);
        $wall = Carbon::instance($moment)->setTimezone(ShopDay::zone($tenant))->toDateString();
        if ($wall === $business) {
            return $business;
        }

        $closedAt = static::query()
            ->where('branch_id', $branchId)
            ->whereDate('trading_date', $business)
            ->where('status', self::STATUS_CLOSED)
            ->value('closed_at');

        return $closedAt !== null && Carbon::parse($closedAt)->lessThanOrEqualTo($moment) ? $wall : $business;
    }

    public function isOpen(): bool
    {
        return $this->status === self::STATUS_OPEN;
    }
}
