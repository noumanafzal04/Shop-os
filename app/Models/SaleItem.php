<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use App\Models\Concerns\HidesCostPrice;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Line snapshot — keeps its own copy of name/price/cost so deleted or
 * repriced products never corrupt sale history.
 */
class SaleItem extends Model
{
    use BelongsToTenant, HasUuids, HidesCostPrice;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'modifiers' => 'array',
            // Exploded BOM snapshot for combo/recipe lines (per-unit component
            // quantities), captured at sale time so returns restock correctly.
            'components' => 'array',
            'quantity' => 'decimal:3',
            'unit_factor' => 'decimal:3',
            'unit_price' => 'decimal:2',
            'unit_cost' => 'decimal:2',
            'line_discount' => 'decimal:2',
            'line_total' => 'decimal:2',
            'tax_rate' => 'decimal:2',
        ];
    }

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class)->withTrashed();
    }

    /** Serialized units (IMEI/serial + warranty) captured for this line. */
    public function serials(): HasMany
    {
        return $this->hasMany(SaleItemSerial::class);
    }

    /**
     * What the shop paid, on this line — stripped for whoever may not read a cost.
     *
     * @return list<string>
     */
    protected function costKeys(): array
    {
        return ['unit_cost'];
    }
}
