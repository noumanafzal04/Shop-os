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

    public function isOpen(): bool
    {
        return $this->status === self::STATUS_OPEN;
    }
}
