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
 *
 * WHICH of it, though, is the row's own business:
 *
 *   neither column     one piece — the base unit
 *   variant_id         one size of it (the 1L, not the 500ml)
 *   product_unit_id    one PACK of it (the carton, not the piece)
 *
 * A row is never both: packs do not combine with sizes anywhere in the product.
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

    /** The pack this code is printed on, when it is a pack's and not a piece's. */
    public function unit(): BelongsTo
    {
        return $this->belongsTo(ProductUnit::class, 'product_unit_id');
    }
}
