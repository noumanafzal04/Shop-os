<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One thing a branch has run out of tonight.
 *
 * `variant_id` null means the whole item is off HERE; set means only that size
 * is. The row's existence is the fact — there is no "is_sold_out" column to
 * drift out of step with it, and no flag on the product for a second reader to
 * find first.
 *
 * A branch is where a thing physically is not, which is why this row is keyed
 * on one. Gulberg running out of pizza bases says nothing about DHA.
 */
class BranchSoldOut extends Model
{
    use BelongsToTenant, HasUuids;

    protected $table = 'branch_sold_out';

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['sold_out_at' => 'datetime'];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function variant(): BelongsTo
    {
        return $this->belongsTo(ProductVariant::class, 'variant_id');
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function markedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'sold_out_by');
    }
}
