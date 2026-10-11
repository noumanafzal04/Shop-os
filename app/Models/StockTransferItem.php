<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One line of a transfer: what left, how much of it arrived, and — where the
 * two differ — why, and what was decided.
 *
 * `quantity` is what was SENT. Where the transfer began as a request,
 * `quantity_requested` keeps what was asked for beside it — a warehouse that
 * sends twenty of the forty a shop asked for has not made a mistake, and the
 * line has to be able to say both numbers.
 *
 * `quantity_received` is null until the receiver has counted the line in.
 * `lots` is the batch and expiry of what left the sender, so a strip of
 * medicine arrives with the date it was received under rather than landing
 * in whatever lot the destination happened to have open.
 */
class StockTransferItem extends Model
{
    use BelongsToTenant;
    use HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:3',
            'quantity_requested' => 'decimal:3',
            'quantity_received' => 'decimal:3',
            'lots' => 'array',
        ];
    }

    public function transfer(): BelongsTo
    {
        return $this->belongsTo(StockTransfer::class, 'stock_transfer_id');
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    /** How much left and did not arrive. Zero until the line is counted in. */
    public function short(): float
    {
        if ($this->quantity_received === null) {
            return 0.0;
        }

        return max(0.0, round((float) $this->quantity - (float) $this->quantity_received, 3));
    }

    /** Short, and nobody has yet said what became of it. */
    public function isUnsettled(): bool
    {
        return $this->short() > 0 && $this->short_outcome === null;
    }
}
