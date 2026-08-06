<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Models\Expense;
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

    /**
     * Deleting a category with costs filed under it would leave a year of
     * "Rent" pointing at nothing — the FK nulls out, so the money survives but
     * its name doesn't, and every report from then on is short a line it can no
     * longer explain. Deactivating hides it from the picker and keeps the
     * history intact, which is what "delete" almost always meant here.
     */
    public function destroy(string $id): JsonResponse
    {
        /** @var ExpenseCategory $category */
        $category = ExpenseCategory::query()->findOrFail($id);

        $used = Expense::query()->where('expense_category_id', $category->id)->count();

        if ($used > 0) {
            throw DomainException::conflict(
                "{$used} expense".($used === 1 ? ' is' : 's are')." filed under {$category->name}. Turn it off instead — that hides it from the picker and keeps the history readable.",
                'CATEGORY_IN_USE',
            );
        }

        $category->delete();

        return ApiResponse::noContent('Expense category deleted');
    }
}
