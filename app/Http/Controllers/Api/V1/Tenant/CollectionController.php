<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Http\Requests\Catalog\StoreCollectionRequest;
use App\Http\Requests\Catalog\UpdateCollectionRequest;
use App\Models\Collection;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class CollectionController extends Controller
{
    public function index(): JsonResponse
    {
        $collections = Collection::query()
            ->withCount('items')
            ->orderBy('sort_order')
            ->get();

        return ApiResponse::ok($collections);
    }

    public function store(StoreCollectionRequest $request): JsonResponse
    {
        $data = $request->validated();

        $collection = DB::transaction(function () use ($data): Collection {
            $collection = Collection::query()->create([
                'name' => $data['name'],
                'slug' => $this->uniqueSlug($data['name']),
                'description' => $data['description'] ?? null,
                'sort_order' => $data['sort_order'] ?? 0,
                'is_active' => $data['is_active'] ?? true,
                'visible_in_marketplace' => $data['visible_in_marketplace'] ?? true,
            ]);
            $this->syncItems($collection, $data['item_ids'] ?? []);

            return $collection;
        });

        return ApiResponse::created($collection->load('items:id,name,price'));
    }

    public function show(string $id): JsonResponse
    {
        return ApiResponse::ok(
            Collection::query()->with('items:id,name,price,item_type')->findOrFail($id),
        );
    }

    public function update(UpdateCollectionRequest $request, string $id): JsonResponse
    {
        $data = $request->validated();
        /** @var Collection $collection */
        $collection = Collection::query()->findOrFail($id);

        DB::transaction(function () use ($collection, $data): void {
            $collection->fill(collect($data)->except('item_ids')->all())->save();
            if (array_key_exists('item_ids', $data)) {
                $this->syncItems($collection, $data['item_ids'] ?? []);
            }
        });

        return ApiResponse::ok($collection->load('items:id,name,price'), 'Collection updated');
    }

    public function destroy(string $id): JsonResponse
    {
        Collection::query()->findOrFail($id)->delete();

        return ApiResponse::noContent('Collection deleted');
    }

    /** Attach items preserving the given order. */
    private function syncItems(Collection $collection, array $itemIds): void
    {
        $sync = [];
        foreach (array_values($itemIds) as $i => $itemId) {
            $sync[$itemId] = ['tenant_id' => $collection->tenant_id, 'sort_order' => $i];
        }
        $collection->items()->sync($sync);
    }

    private function uniqueSlug(string $name): string
    {
        $base = Str::slug($name) ?: 'collection';
        $slug = $base;
        $n = 1;
        while (Collection::query()->where('slug', $slug)->exists()) {
            $slug = $base.'-'.(++$n);
        }

        return $slug;
    }
}
