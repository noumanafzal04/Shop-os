<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Stock that left without being sold, and what the shop is owed for it.
 *
 * The two dispositions are not two flavours of the same thing and must never be
 * summed together:
 *
 *   WRITTEN_OFF          — in the bin. Money already lost. It belongs in the
 *                          year's expiry cost.
 *   RETURNED_TO_SUPPLIER — sent back for credit. Money NOT yet lost, and not
 *                          yet recovered either. It belongs in a claims list
 *                          somebody chases.
 *
 * Adding them would produce a "loss" figure that overstates by everything the
 * distributor is about to pay back, which is the number a pharmacist would then
 * make decisions against.
 */
class StockDisposal extends BaseModel
{
    use Auditable, BelongsToTenant;

    public const WRITTEN_OFF = 'written_off';

    public const RETURNED = 'returned_to_supplier';

    public const DISPOSITIONS = [self::WRITTEN_OFF, self::RETURNED];

    /** WHY it left, which is a different question from WHERE IT WENT. */
    public const REASONS = ['expired', 'damaged', 'recall', 'other'];

    protected function casts(): array
    {
        return [
            'expiry_date' => 'date',
            'credit_received_at' => 'date',
            'disposed_at' => 'datetime',
            'quantity' => 'decimal:3',
            'unit_cost' => 'decimal:2',
            'total_cost' => 'decimal:2',
            'credit_expected' => 'decimal:2',
            'credit_received' => 'decimal:2',
        ];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class)->withTrashed();
    }

    public function supplier(): BelongsTo
    {
        return $this->belongsTo(Supplier::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * Sent back and not yet credited — the list a pharmacist works through with
     * the distributor's rep on the phone.
     *
     * A return with no `credit_expected` still counts as outstanding: the shop
     * does not always know what the credit will come to, and dropping those
     * rows would quietly shorten the list of things worth chasing.
     */
    public function scopeAwaitingCredit(Builder $query): Builder
    {
        return $query
            ->where('disposition', self::RETURNED)
            ->whereNull('credit_received_at');
    }

    /** Has the distributor settled this one? */
    public function isCredited(): bool
    {
        return $this->credit_received_at !== null;
    }
}
