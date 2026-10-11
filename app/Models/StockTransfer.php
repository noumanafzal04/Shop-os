<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Stock moving from one place to another — a shop to a shop, a warehouse to a
 * shop, a shop back to the warehouse.
 *
 * ── It is SENT, and then it is RECEIVED ─────────────────────────────────
 *
 * It used to be one instant: out of here, into there. That is the truth when
 * the godown is the room behind the counter, and it stays available as a
 * "move". It is not the truth when thirty cartons go across the city on a
 * van: twenty-eight arrive, and a record that says thirty arrived has just
 * made two cartons disappear with nobody's name on them.
 *
 *   requested   asked for by the place that needs it. Nothing has moved;
 *               the sender sends it, sends less, or declines.
 *   in_transit  left the sender, not yet counted in by the receiver.
 *               It is on NO shelf — neither place can sell it.
 *   short       counted in, and less arrived than left. What arrived is on
 *               the receiver's shelf; the rest is waiting for a decision.
 *   completed   everything is accounted for: all of it arrived, or the part
 *               that did not was put back at the sender or written off.
 *   cancelled   called back before it arrived; it is on the sender's shelf.
 *
 * `OPEN` is the three that still need somebody: one needs answering, one
 * needs counting in, the other needs deciding.
 */
class StockTransfer extends BaseModel
{
    use BelongsToTenant;

    public const REQUESTED = 'requested';

    public const IN_TRANSIT = 'in_transit';

    public const SHORT = 'short';

    public const COMPLETED = 'completed';

    public const CANCELLED = 'cancelled';

    public const STATUSES = [self::REQUESTED, self::IN_TRANSIT, self::SHORT, self::COMPLETED, self::CANCELLED];

    public const OPEN = [self::REQUESTED, self::IN_TRANSIT, self::SHORT];

    /** Why less arrived than left. */
    public const SHORT_REASONS = ['missing', 'damaged'];

    /** What was decided about the part that did not arrive. */
    public const OUTCOME_RETURNED = 'returned';

    public const OUTCOME_WRITTEN_OFF = 'written_off';

    public const SHORT_OUTCOMES = [self::OUTCOME_RETURNED, self::OUTCOME_WRITTEN_OFF];

    protected function casts(): array
    {
        return [
            'sent_at' => 'datetime',
            'received_at' => 'datetime',
            'settled_at' => 'datetime',
            'cancelled_at' => 'datetime',
        ];
    }

    public function items(): HasMany
    {
        return $this->hasMany(StockTransferItem::class);
    }

    public function fromBranch(): BelongsTo
    {
        return $this->belongsTo(Branch::class, 'from_branch_id');
    }

    public function toBranch(): BelongsTo
    {
        return $this->belongsTo(Branch::class, 'to_branch_id');
    }

    /** Who loaded the van. Not always who made the row: a request is made by the place asking. */
    public function sender(): BelongsTo
    {
        return $this->belongsTo(User::class, 'sent_by');
    }

    /** Who asked for it, when it began as a request. */
    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function receiver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'received_by');
    }

    /** Transfers that touch a place, in either direction. */
    public function scopeTouching(Builder $query, string $branchId): Builder
    {
        return $query->where(fn (Builder $q) => $q->where('from_branch_id', $branchId)->orWhere('to_branch_id', $branchId));
    }
}
