<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Per-branch on-hand quantity for a stock target (product, or a specific
 * variant) at a branch. The source of truth for stock; product.stock_quantity
 * is a sum-across-branches rollup kept in step by InventoryService.
 *
 * No soft-deletes / audit fields — it's a live counter, not a document.
 */
class BranchStock extends Model
{
    use BelongsToTenant;
    use HasUuids;

    protected $table = 'branch_stock';

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['quantity' => 'decimal:3'];
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function variant(): BelongsTo
    {
        return $this->belongsTo(ProductVariant::class, 'variant_id');
    }
}
