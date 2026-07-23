<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An alternate barcode for a product (grocery/mart: supplier packs, old/new
 * labels, inner/outer cartons). The product's own `barcode` is the primary;
 * these are additional codes that all resolve to the same item at the POS.
 */
class ProductBarcode extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function variant(): BelongsTo
    {
        return $this->belongsTo(ProductVariant::class, 'variant_id');
    }
}
