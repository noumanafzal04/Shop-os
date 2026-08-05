<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A parked POS cart a cashier can resume later. The cart is an opaque
 * client-side snapshot (line items, customer, discount) stored as JSON.
 *
 * A ticket is parked at a LANE but belongs to the BRANCH: the customer who
 * comes back may well walk up to a different checkout.
 */
class HeldSale extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'cart' => 'array',
            'total_estimate' => 'decimal:2',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function register(): BelongsTo
    {
        return $this->belongsTo(Register::class);
    }
}
