<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

/**
 * Expense categories: seeded from the business-type template, but the owner
 * can always add, rename, deactivate or delete them.
 */
class ExpenseCategoryController extends Controller
{
    /**
     * Every category with what is actually filed under it.
     *
     * The counts are the difference between a screen that lets you try to
     * delete a category and one that tells you first. A category with history
     * can only be turned off (see destroy) — knowing that BEFORE clicking is
     * the whole point, and the running total is what makes the list worth
     * reading rather than merely maintaining.
     */
    public function index(Request $request): JsonResponse
    {
        $query = ExpenseCategory::query()
            // A list long enough to need searching is exactly the list you
            // cannot afford to filter in the browser.
            ->when(
                trim((string) $request->query('search')) !== '',
                fn ($q) => $q->where('name', 'like', '%'.trim((string) $request->query('search')).'%'),
            )
            ->orderBy('name');

        // Opt-in, so the picker that has always received a flat array still
        // does. `per_page` is what a management screen sends once it grows past
        // one screenful.
        if ($request->filled('per_page')) {
            $page = $query->paginate(min((int) $request->query('per_page'), 100));
            $page->setCollection($this->withTotals($page->getCollection()));

            return ApiResponse::paginated($page);
        }

        return ApiResponse::ok($this->withTotals($query->get()));
    }

    /**
     * Attach "what is filed here" to each row.
     *
     * These used to be `withCount` + `withSum`, which is two correlated
     * subqueries per category — the cost grows with the catalogue AND with the
     * expense history behind it, on an endpoint the expense form loads every
     * time it opens. One grouped pass over the expenses answers both, and the
     * response is byte-for-byte what it was.
     *
     * @param  Collection<int, ExpenseCategory>  $categories
     * @return Collection<int, array<string, mixed>>
     */
    private function withTotals(Collection $categories): Collection
    {
        $filed = Expense::query()
            ->whereIn('expense_category_id', $categories->pluck('id'))
            ->selectRaw('expense_category_id, COUNT(*) as entries, COALESCE(SUM(amount), 0) as total')
            ->groupBy('expense_category_id')
            ->get()
            ->keyBy('expense_category_id');

        return $categories->map(fn (ExpenseCategory $c): array => array_merge($c->toArray(), [
            'entries_count' => (int) ($filed[$c->id]->entries ?? 0),
            'entries_total' => round((float) ($filed[$c->id]->total ?? 0), 2),
        ]));
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
