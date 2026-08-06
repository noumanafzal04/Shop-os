<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A unit somebody brought back.
 *
 * Not a return: no money moves, no stock moves, and the unit is usually gone
 * to a service centre for days. The shop is holding someone else's property
 * and needs to be able to say so — which is the whole reason this exists
 * separately from a sale return.
 *
 * An OPEN claim is one with no resolution. That is the state itself rather
 * than a status column beside it, so the two can never disagree.
 */
class WarrantyClaim extends BaseModel
{
    use BelongsToTenant;

    /**
     * How a claim ends. `rejected` is a real outcome, not a failure — a shop
     * that cannot record "this was physical damage, not a fault" has no defence
     * the second time the customer asks.
     */
    public const RESOLUTIONS = ['repaired', 'replaced', 'refunded', 'rejected'];

    protected function casts(): array
    {
        return [
            'was_under_warranty' => 'boolean',
            'warranty_expires_at' => 'date',
            'resolved_at' => 'datetime',
        ];
    }

    public function serialRecord(): BelongsTo
    {
        return $this->belongsTo(SaleItemSerial::class, 'sale_item_serial_id');
    }

    public function resolver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'resolved_by');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** Still with the shop — nobody has said what happened to it yet. */
    public function isOpen(): bool
    {
        return $this->resolution === null;
    }
}
