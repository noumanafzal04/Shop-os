<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Category extends BaseModel
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'sort_order' => 'integer',
        ];
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(Category::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(Category::class, 'parent_id')->orderBy('sort_order');
    }

    /** Full subtree (with per-node product counts) — unlimited depth. */
    public function childrenRecursive(): HasMany
    {
        return $this->children()->withCount('products')->with('childrenRecursive');
    }

    public function products(): HasMany
    {
        return $this->hasMany(Product::class);
    }

    /**
     * THIS CATEGORY AND EVERY ONE UNDER IT, to any depth.
     *
     * A shop files its shirts under Men → Shirts, and "count Men" found
     * nothing (B15): the count asked for items filed under Men itself, and a
     * parent category holds its items in its children. Asked of the shop's
     * whole tree in one read — a shop has dozens of categories, not
     * thousands — and walked here, so a loop in old data cannot hang it.
     *
     * @return list<string>
     */
    public static function selfAndBelow(string $categoryId): array
    {
        $childrenOf = static::query()->whereNotNull('parent_id')->get(['id', 'parent_id'])->groupBy('parent_id');

        $found = [$categoryId => true];
        $next = [$categoryId];
        while ($next !== []) {
            $below = [];
            foreach ($next as $id) {
                foreach ($childrenOf->get($id, collect()) as $child) {
                    if (! isset($found[$child->id])) {
                        $found[$child->id] = true;
                        $below[] = $child->id;
                    }
                }
            }
            $next = $below;
        }

        return array_keys($found);
    }

    /**
     * Walks up the tree — used to block circular parents.
     */
    public function isDescendantOf(string $categoryId): bool
    {
        $current = $this->parent;

        while ($current !== null) {
            if ($current->id === $categoryId) {
                return true;
            }
            $current = $current->parent;
        }

        return false;
    }
}
