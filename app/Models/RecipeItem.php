<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One line of a dish's recipe: a raw ingredient product + how much of it one
 * portion consumes. Selling the dish draws this quantity out of the
 * ingredient's stock. See App\Models\RecipeItem usage in CreateSaleAction.
 */
class RecipeItem extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['quantity' => 'decimal:3'];
    }

    public function dish(): BelongsTo
    {
        return $this->belongsTo(Product::class, 'dish_product_id');
    }

    public function ingredient(): BelongsTo
    {
        return $this->belongsTo(Product::class, 'ingredient_product_id');
    }
}
