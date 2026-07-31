<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One physical serialized unit's lifecycle in stock (see the serial_inventory
 * migration): received in_stock, sold (linked to the sale), then back to
 * in_stock if that unit is returned.
 */
class ProductSerial extends BaseModel
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'received_at' => 'datetime',
        ];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function isInStock(): bool
    {
        return $this->status === 'in_stock';
    }
}
