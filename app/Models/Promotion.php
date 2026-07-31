<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An automatic, scheduled discount (see the promotions migration). Evaluated
 * server-side by PromotionService at sale time — never a code the customer
 * enters.
 */
class Promotion extends BaseModel
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'value' => 'decimal:2',
            'min_spend' => 'decimal:2',
            'min_qty' => 'decimal:3',
            'buy_qty' => 'decimal:3',
            'get_qty' => 'decimal:3',
            'get_discount_pct' => 'decimal:2',
            'max_discount' => 'decimal:2',
            'product_ids' => 'array',
            'days_of_week' => 'array',
            'starts_on' => 'date',
            'ends_on' => 'date',
            'priority' => 'integer',
            'is_active' => 'boolean',
        ];
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }
}
