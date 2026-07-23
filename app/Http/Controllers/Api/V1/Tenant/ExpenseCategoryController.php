<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Models\ExpenseCategory;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Expense categories: seeded from the business-type template, but the owner
 * can always add, rename, deactivate or delete them.
 */
class ExpenseCategoryController extends Controller
{
    public function index(): JsonResponse
    {
        return ApiResponse::ok(
            ExpenseCategory::query()->orderBy('name')->get(),
        );
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => [
                'required', 'string', 'max:100',
                Rule::unique('expense_categories', 'name')
                    ->where('tenant_id', $request->user()->tenant_id)
                    ->whereNull('deleted_at'),
            ],
        ]);

        return ApiResponse::created(ExpenseCategory::query()->create($data));
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $category = ExpenseCategory::query()->findOrFail($id);

        $data = $request->validate([
            'name' => [
                'sometimes', 'required', 'string', 'max:100',
                Rule::unique('expense_categories', 'name')
                    ->where('tenant_id', $request->user()->tenant_id)
                    ->ignore($id)
                    ->whereNull('deleted_at'),
            ],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $category->fill($data)->save();

        return ApiResponse::ok($category, 'Expense category updated');
    }

    public function destroy(string $id): JsonResponse
    {
        ExpenseCategory::query()->findOrFail($id)->delete();

        return ApiResponse::noContent('Expense category deleted');
    }
}
