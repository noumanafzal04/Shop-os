<?php

namespace App\Actions\Catalog;

use App\Exceptions\DomainException;
use App\Models\Category;

/**
 * Edge case "delete category with products": blocked with a clear error —
 * the owner moves the items (or passes reassign_to) first, so items never
 * silently lose their category.
 */
class DeleteCategoryAction
{
    public function execute(Category $category, ?string $reassignToId = null): void
    {
        if ($category->children()->exists()) {
            throw DomainException::conflict(
                'This category has sub-categories. Move or delete them first.',
                'CATEGORY_HAS_CHILDREN',
            );
        }

        $productsCount = $category->products()->count();

        if ($productsCount > 0) {
            if ($reassignToId === null) {
                throw DomainException::conflict(
                    "This category contains {$productsCount} item(s). Pass reassign_to or move them first.",
                    'CATEGORY_HAS_PRODUCTS',
                );
            }

            if ($reassignToId === $category->id) {
                throw DomainException::unprocessable('Cannot reassign items to the category being deleted.', 'CATEGORY_REASSIGN_SELF');
            }

            // Tenant scope guarantees the target belongs to this tenant.
            $target = Category::query()->findOrFail($reassignToId);
            $category->products()->update(['category_id' => $target->id]);
        }

        $category->delete();
    }
}
