<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Catalog\DeleteCategoryAction;
use App\Actions\Catalog\UpdateCategoryAction;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Catalog\ReorderCategoriesRequest;
use App\Http\Requests\Catalog\StoreCategoryRequest;
use App\Http\Requests\Catalog\UpdateCategoryRequest;
use App\Models\Category;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CategoryController extends Controller
{
    /**
     * Full tree (roots with UNLIMITED nested children) — categories are small
     * per tenant, so no pagination here.
     */
    public function index(Request $request): JsonResponse
    {
        $categories = Category::query()
            ->whereNull('parent_id')
            ->with('childrenRecursive')
            ->withCount('products')
            ->when($request->boolean('active_only'), fn ($q) => $q->where('is_active', true))
            ->orderBy('sort_order')
            ->get();

        // Present the recursive subtree under the stable `children` key.
        return ApiResponse::ok($categories->map(fn (Category $c) => $this->nodeToArray($c))->all());
    }

    /** Recursively serialize a category node + its unlimited-depth children. */
    private function nodeToArray(Category $category): array
    {
        return [
            'id' => $category->id,
            'parent_id' => $category->parent_id,
            'name' => $category->name,
            'image_path' => $category->image_path,
            'sort_order' => $category->sort_order,
            'is_active' => $category->is_active,
            'products_count' => $category->products_count ?? 0,
            'children' => $category->childrenRecursive
                ->map(fn (Category $child) => $this->nodeToArray($child))
                ->all(),
        ];
    }

    /**
     * Bulk reorder / reparent after a drag. Accepts a flat list of
     * { id, sort_order, parent_id } — each row tenant-scoped by the global
     * scope. A node may not become its own descendant.
     */
    public function reorder(ReorderCategoriesRequest $request): JsonResponse
    {
        DB::transaction(function () use ($request): void {
            foreach ($request->validated('categories') as $row) {
                /** @var Category $cat */
                $cat = Category::query()->findOrFail($row['id']);
                $parentId = $row['parent_id'] ?? null;

                if ($parentId !== null && ($parentId === $cat->id
                    || Category::query()->findOrFail($parentId)->isDescendantOf($cat->id))) {
                    throw DomainException::unprocessable('Cannot nest a category inside itself.', 'CATEGORY_CYCLE');
                }

                $cat->forceFill([
                    'parent_id' => $parentId,
                    'sort_order' => $row['sort_order'] ?? 0,
                ])->save();
            }
        });

        return ApiResponse::ok(null, 'Order saved');
    }

    public function store(StoreCategoryRequest $request): JsonResponse
    {
        $category = Category::query()->create($request->validated());

        return ApiResponse::created($category->load('parent'));
    }

    public function show(string $id): JsonResponse
    {
        return ApiResponse::ok(
            Category::query()->with('parent', 'children')->withCount('products')->findOrFail($id),
        );
    }

    public function update(UpdateCategoryRequest $request, string $id, UpdateCategoryAction $action): JsonResponse
    {
        $category = $action->execute(Category::query()->findOrFail($id), $request->validated());

        return ApiResponse::ok($category, 'Category updated');
    }

    public function destroy(Request $request, string $id, DeleteCategoryAction $action): JsonResponse
    {
        $action->execute(
            Category::query()->findOrFail($id),
            $request->query('reassign_to'),
        );

        return ApiResponse::noContent('Category deleted');
    }
}
