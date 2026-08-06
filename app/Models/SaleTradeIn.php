<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Goods taken in part-payment: the dead battery, the worn set of tyres, the
 * old phone. One row per item accepted, with the allowance given for it.
 *
 * The allowance also enters stock through InventoryService, so the scrap is a
 * countable asset from the moment it crosses the counter rather than something
 * that appears in the yard and leaves without a record.
 */
class SaleTradeIn extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:3',
            'unit_allowance' => 'decimal:2',
            'total_allowance' => 'decimal:2',
            'reversed_at' => 'datetime',
        ];
    }

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    /** Already handed back — a voided sale, or a return the customer undid. */
    public function isReversed(): bool
    {
        return $this->reversed_at !== null;
    }
}
