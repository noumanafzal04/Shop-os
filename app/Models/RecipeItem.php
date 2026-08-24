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
 *
 * A row may name a SIZE (`variant_id`), because a kitchen runs out of large
 * bases rather than of pizza. Which rows apply is App\Support\RecipeFor's
 * single answer, not each caller's.
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

    /**
     * WHICH SIZE this row is the recipe for, or null for "the dish, whatever
     * size" — which is what every row was before sizes could be named, and
     * what a size with nothing of its own falls back to. See App\Support\RecipeFor.
     */
    public function variant(): BelongsTo
    {
        return $this->belongsTo(ProductVariant::class, 'variant_id');
    }

    public function ingredient(): BelongsTo
    {
        return $this->belongsTo(Product::class, 'ingredient_product_id');
    }
}
