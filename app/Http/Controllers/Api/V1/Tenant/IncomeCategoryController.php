<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Models\Income;
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
    /**
     * Every category with what is filed under it — see the expense mirror for
     * why the counts belong in the list rather than in a failed delete.
     */
    public function index(): JsonResponse
    {
        return ApiResponse::ok(
            IncomeCategory::query()
                ->withCount('incomes')
                ->withSum('incomes', 'amount')
                ->orderBy('name')
                ->get()
                ->map(fn (IncomeCategory $c): array => array_merge($c->toArray(), [
                    'entries_count' => (int) $c->incomes_count,
                    'entries_total' => round((float) ($c->incomes_sum_amount ?? 0), 2),
                ])),
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

    /** Same rule as expense categories: history keeps its name. */
    public function destroy(string $id): JsonResponse
    {
        /** @var IncomeCategory $category */
        $category = IncomeCategory::query()->findOrFail($id);

        $used = Income::query()->where('income_category_id', $category->id)->count();

        if ($used > 0) {
            throw DomainException::conflict(
                "{$used} income entr".($used === 1 ? 'y is' : 'ies are')." filed under {$category->name}. Turn it off instead — that hides it from the picker and keeps the history readable.",
                'CATEGORY_IN_USE',
            );
        }

        $category->delete();

        return ApiResponse::noContent('Income category deleted');
    }
}
