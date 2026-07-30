<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One line of a customer's loyalty ledger: `earn` (+points from a sale),
 * `redeem` (−points spent at the counter), or a `reverse_earn` / `reverse_redeem`
 * from a return/cancellation. `points` is always positive; `type` gives the
 * direction. `balance_after` snapshots the running balance. Append-only —
 * extends Model directly like CustomerLedgerEntry.
 */
class LoyaltyEntry extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }
}
