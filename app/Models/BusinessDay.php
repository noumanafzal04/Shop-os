<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

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

    public function isOpen(): bool
    {
        return $this->status === self::STATUS_OPEN;
    }
}
