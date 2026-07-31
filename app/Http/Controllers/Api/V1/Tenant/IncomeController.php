<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Http\Requests\Income\StoreIncomeRequest;
use App\Models\Income;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Manual, non-sales income entries (rent received, owner investment, supplier
 * refund, misc). Sales revenue is NOT recorded here — the Cashbook derives it
 * from sales — so nothing double-counts. Mirrors ExpenseController.
 */
class IncomeController extends Controller
{
    public function __construct(private readonly BranchContext $branch) {}

    public function index(Request $request): JsonResponse
    {
        $branchScope = $this->branch->scopeId();

        $incomes = Income::query()
            ->with('category:id,name')
            ->when($branchScope, fn ($q, $b) => $q->where('branch_id', $b))
            ->when($request->query('search'), fn ($q, $s) => $q->where('description', 'like', "%{$s}%"))
            ->when($request->query('category_id'), fn ($q, $id) => $q->where('income_category_id', $id))
            ->when($request->query('from'), fn ($q, $from) => $q->where('income_date', '>=', $from))
            ->when($request->query('to'), fn ($q, $to) => $q->where('income_date', '<=', $to))
            ->orderByDesc('income_date')
            ->orderByDesc('created_at')
            ->paginate(min((int) $request->query('per_page', 15), 100));

        return ApiResponse::paginated($incomes);
    }

    public function store(StoreIncomeRequest $request): JsonResponse
    {
        $data = $request->validated() + ['branch_id' => $this->branch->id()];

        // Edge case "duplicate income": same category+amount+date already
        // recorded → still allowed (a monthly rent CAN repeat) but flagged as a
        // warning the UI surfaces before the user assumes it saved twice.
        $duplicate = Income::query()
            ->where('income_category_id', $data['income_category_id'])
            ->where('amount', $data['amount'])
            ->whereDate('income_date', $data['income_date'])
            ->exists();

        $income = Income::query()->create($data)->load('category:id,name');

        return response()->json([
            'success' => true,
            'message' => 'Income recorded',
            'data' => $income,
            'errors' => (object) [],
            'meta' => (object) array_filter([
                'warnings' => $duplicate
                    ? ['A very similar income (same category, amount and date) already exists.']
                    : [],
            ]),
        ], 201);
    }

    public function update(StoreIncomeRequest $request, string $id): JsonResponse
    {
        $income = Income::query()->findOrFail($id);
        $income->fill($request->validated())->save();

        return ApiResponse::ok($income->load('category:id,name'), 'Income updated');
    }

    public function destroy(string $id): JsonResponse
    {
        Income::query()->findOrFail($id)->delete();

        return ApiResponse::noContent('Income deleted');
    }
}
