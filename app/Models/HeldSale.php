<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * A parked POS cart a cashier can resume later. The cart is an opaque
 * client-side snapshot (line items, customer, discount) stored as JSON.
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
}
