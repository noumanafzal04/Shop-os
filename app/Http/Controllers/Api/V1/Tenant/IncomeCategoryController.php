<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Models\IncomeCategory;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Income categories: seeded from a generic template on setup, but the owner
 * can always add, rename, deactivate or delete them. Mirrors
 * ExpenseCategoryController.
 */
class IncomeCategoryController extends Controller
{
    public function index(): JsonResponse
    {
        return ApiResponse::ok(
            IncomeCategory::query()->orderBy('name')->get(),
        );
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => [
                'required', 'string', 'max:100',
                Rule::unique('income_categories', 'name')
                    ->where('tenant_id', $request->user()->tenant_id)
                    ->whereNull('deleted_at'),
            ],
        ]);

        return ApiResponse::created(IncomeCategory::query()->create($data));
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $category = IncomeCategory::query()->findOrFail($id);

        $data = $request->validate([
            'name' => [
                'sometimes', 'required', 'string', 'max:100',
                Rule::unique('income_categories', 'name')
                    ->where('tenant_id', $request->user()->tenant_id)
                    ->ignore($id)
                    ->whereNull('deleted_at'),
            ],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $category->fill($data)->save();

        return ApiResponse::ok($category, 'Income category updated');
    }

    public function destroy(string $id): JsonResponse
    {
        IncomeCategory::query()->findOrFail($id)->delete();

        return ApiResponse::noContent('Income category deleted');
    }
}
