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
use App\Support\BranchContext;
use App\Support\CatalogPlaces;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;

class CategoryController extends Controller
{
    /**
     * Full tree (roots with UNLIMITED nested children) — categories are small
     * per tenant, so no pagination here.
     */
    public function index(Request $request, BranchContext $branch): JsonResponse
    {
        // What this branch shows (CatalogPlaces): listed here, or holding something
        // sold here, and the parents above it. The owner's "All branches": everything.
        // A selling screen's chips (`sold_here`) are the branch it rings at.
        $this->shown = CatalogPlaces::categoriesShownAt(
            $request->boolean('sold_here') ? $branch->id() : CatalogPlaces::listScope($request->user(), $branch),
        );
        $this->placesOf = DB::table('branch_category')->get(['category_id', 'branch_id'])
            ->groupBy('category_id')->map(fn ($rows) => $rows->pluck('branch_id')->map(fn ($b) => (string) $b)->all())->all();

        $categories = Category::query()
            ->whereNull('parent_id')
            ->with('childrenRecursive')
            ->withCount('products')
            ->when($request->boolean('active_only'), fn ($q) => $q->where('is_active', true))
            ->orderBy('sort_order')
            ->get();

        // Present the recursive subtree under the stable `children` key.
        return ApiResponse::ok($categories
            ->filter(fn (Category $c) => $this->shown === null || isset($this->shown[(string) $c->id]))
            ->values()
            ->map(fn (Category $c) => $this->nodeToArray($c))->all());
    }

    /** @var array<string, true>|null the categories shown at this branch; null = all */
    private ?array $shown = null;

    /** @var array<string, list<string>> category id → the branches it is listed at by name */
    private array $placesOf = [];

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
            'all_branches' => (bool) ($category->all_branches ?? true),
            'branch_ids' => $this->placesOf[(string) $category->id] ?? [],
            'products_count' => $category->products_count ?? 0,
            'children' => $category->childrenRecursive
                ->filter(fn (Category $child) => $this->shown === null || isset($this->shown[(string) $child->id]))
                ->values()
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

    public function store(StoreCategoryRequest $request, BranchContext $branch): JsonResponse
    {
        $data = $request->validated();
        $places = CatalogPlaces::resolve($request->user(), array_key_exists('all_branches', $data) ? (bool) $data['all_branches'] : null, $data['branch_ids'] ?? null, $branch->id())
            ?? CatalogPlaces::forNew($request->user(), $branch->id());
        $category = Category::query()->create(Arr::except($data, ['all_branches', 'branch_ids']));
        CatalogPlaces::save($category, $places);

        return ApiResponse::created($category->load('parent'));
    }

    public function show(string $id): JsonResponse
    {
        return ApiResponse::ok(
            Category::query()->with('parent', 'children')->withCount('products')->findOrFail($id),
        );
    }

    public function update(UpdateCategoryRequest $request, string $id, UpdateCategoryAction $action, BranchContext $branch): JsonResponse
    {
        $found = Category::query()->findOrFail($id);
        CatalogPlaces::assertMayChange($request->user(), $found, $branch->id());
        $data = $request->validated();
        $places = CatalogPlaces::resolve($request->user(), array_key_exists('all_branches', $data) ? (bool) $data['all_branches'] : null, $data['branch_ids'] ?? null, $branch->id());
        $category = $action->execute($found, Arr::except($data, ['all_branches', 'branch_ids']));
        if ($places !== null) {
            CatalogPlaces::save($category, $places);
        }

        return ApiResponse::ok($category, 'Category updated');
    }

    public function destroy(Request $request, string $id, DeleteCategoryAction $action, BranchContext $branch): JsonResponse
    {
        $found = Category::query()->findOrFail($id);
        CatalogPlaces::assertMayChange($request->user(), $found, $branch->id());
        $action->execute(
            $found,
            $request->query('reassign_to'),
        );

        return ApiResponse::noContent('Category deleted');
    }
}
