<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Support\Facades\Storage;

/**
 * A display section (Popular, Deals, New Arrival…) that cross-cuts categories.
 * Owners attach any items; the marketplace renders visible collections in
 * sort order, FoodPanda-style.
 */
class Collection extends BaseModel
{
    use BelongsToTenant;

    protected $appends = ['image_url'];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'visible_in_marketplace' => 'boolean',
            'sort_order' => 'integer',
        ];
    }

    public function items(): BelongsToMany
    {
        return $this->belongsToMany(Product::class, 'collection_item')
            ->withPivot('sort_order')
            ->withTimestamps()
            ->orderBy('collection_item.sort_order');
    }

    protected function imageUrl(): Attribute
    {
        return Attribute::get(
            fn (): ?string => $this->image_path ? Storage::disk('public')->url($this->image_path) : null,
        );
    }
}
