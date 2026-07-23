<?php

namespace App\Actions\Catalog;

use App\Exceptions\DomainException;
use App\Models\Category;

class UpdateCategoryAction
{
    public function execute(Category $category, array $data): Category
    {
        if (array_key_exists('parent_id', $data) && $data['parent_id'] !== null) {
            // Edge cases: self-parenting and circular trees are impossible.
            if ($data['parent_id'] === $category->id) {
                throw DomainException::unprocessable('A category cannot be its own parent.', 'CATEGORY_SELF_PARENT');
            }

            $newParent = Category::query()->findOrFail($data['parent_id']);

            if ($newParent->isDescendantOf($category->id)) {
                throw DomainException::unprocessable(
                    'This would create a circular category structure.',
                    'CATEGORY_CIRCULAR',
                );
            }
        }

        $category->fill($data)->save();

        return $category->load('parent', 'children');
    }
}
