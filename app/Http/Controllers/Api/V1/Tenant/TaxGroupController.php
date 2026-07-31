<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Http\Requests\TaxGroup\StoreTaxGroupRequest;
use App\Models\TaxGroup;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * Tax groups — named, reusable rates a product can point at. Change the group
 * once and every product on it re-rates at the next sale.
 */
class TaxGroupController extends Controller
{
    public function index(): JsonResponse
    {
        return ApiResponse::ok(
            TaxGroup::query()->withCount('products')->orderBy('name')->get(),
        );
    }

    public function store(StoreTaxGroupRequest $request): JsonResponse
    {
        return ApiResponse::created(TaxGroup::query()->create($request->validated()), 'Tax group created');
    }

    public function update(StoreTaxGroupRequest $request, string $id): JsonResponse
    {
        $group = TaxGroup::query()->findOrFail($id);
        $group->update($request->validated());

        return ApiResponse::ok($group, 'Tax group updated');
    }

    /**
     * Deleting a group nulls tax_group_id on its products (FK nullOnDelete), so
     * they fall back to their own tax_rate / the shop default — never orphaned.
     */
    public function destroy(string $id): JsonResponse
    {
        TaxGroup::query()->findOrFail($id)->delete();

        return ApiResponse::noContent('Tax group deleted');
    }
}
