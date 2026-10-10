<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A larger pack a product can be sold in on top of its base unit (pharmacy:
 * Strip/Box; grocery: Carton). `factor` = how many base units this pack holds;
 * `price` is the explicit pack price (null → base price × factor).
 */
class ProductUnit extends Model
{
    use BelongsToTenant, HasUuids, SoftDeletes;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'factor' => 'decimal:3',
            'price' => 'decimal:2',
        ];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    /**
     * Every OTHER code printed on this pack — `barcode` is the first.
     *
     * Not eager-loaded and not appended: a caller that has not loaded these
     * does not know them, and must not send back an empty list as though it
     * did — see SyncProductUnitsAction, where an absent list means "as it was".
     */
    public function codes(): HasMany
    {
        return $this->hasMany(ProductBarcode::class, 'product_unit_id')->orderBy('created_at')->orderBy('id');
    }

    /** Price for one of this pack: explicit price, else base selling price × factor. */
    public function priceUsing(float $basePrice): float
    {
        return $this->price !== null ? (float) $this->price : round($basePrice * (float) $this->factor, 2);
    }
}
