<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Models\Expense;
use App\Models\ExpenseBudget;
use App\Models\ExpenseCategory;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

/**
 * Ceilings per expense category, and how the month is tracking against them.
 *
 * A budget here never blocks anything. The bill arrived; refusing to record it
 * doesn't unspend the money, it only stops the books matching the world. What a
 * ceiling buys is the sentence at the moment of entry — "Ingredients is now
 * 4,200 over its 60,000 budget for August" — because that is the only moment
 * anyone can still do something about it.
 */
class ExpenseBudgetController extends Controller
{
    public function __construct(private readonly BranchContext $branch) {}

    /**
     * Every category with its ceiling and what has been spent against it this
     * month — including categories with no budget set, because "unbudgeted"
     * and "budget of zero" are different states and the owner needs to see
     * which is which.
     */
    public function index(Request $request): JsonResponse
    {
        $month = Carbon::parse($request->query('month', now()->toDateString()))->startOfMonth();
        $branchScope = $this->branch->scopeId();

        $spend = Expense::query()
            ->when($branchScope, fn ($q, $b) => $q->where('branch_id', $b))
            ->whereBetween('expense_date', [$month, $month->copy()->endOfMonth()])
            ->selectRaw('expense_category_id, COALESCE(SUM(amount), 0) as spent')
            ->groupBy('expense_category_id')
            ->pluck('spent', 'expense_category_id');

        $rows = ExpenseCategory::query()
            ->where('is_active', true)
            ->orderBy('name')
            ->get()
            ->map(function (ExpenseCategory $c) use ($month, $branchScope, $spend): array {
                $ceiling = ExpenseBudget::ceilingFor($c->id, $month, $branchScope);
                $spent = round((float) ($spend[$c->id] ?? 0), 2);

                return [
                    'expense_category_id' => $c->id,
                    'category' => $c->name,
                    'budget' => $ceiling,
                    'spent' => $spent,
                    'remaining' => $ceiling === null ? null : round($ceiling - $spent, 2),
                    'over' => $ceiling !== null && $spent > $ceiling,
                ];
            });

        return ApiResponse::ok($rows, 'OK', ['month' => $month->format('Y-m')]);
    }

    /**
     * Set or clear a ceiling. A null amount removes the budget entirely, which
     * is not the same as setting it to zero — zero means "spend nothing here".
     */
    public function store(Request $request): JsonResponse
    {
        abort_unless($request->user()->hasPermission(Permissions::EXPENSES_MANAGE), 403);

        $data = $request->validate([
            'expense_category_id' => [
                'required', 'uuid',
                Rule::exists('expense_categories', 'id')
                    ->where('tenant_id', $request->user()->tenant_id)
                    ->whereNull('deleted_at'),
            ],
            'amount' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            // Omit for the standing monthly ceiling; give a month to override
            // it for that month alone.
            'month' => ['nullable', 'date'],
        ]);

        $month = isset($data['month']) ? Carbon::parse($data['month'])->startOfMonth()->toDateString() : null;
        $branchId = $this->branch->scopeId();

        $existing = ExpenseBudget::query()
            ->where('expense_category_id', $data['expense_category_id'])
            ->where('branch_id', $branchId)
            ->when($month === null, fn ($q) => $q->whereNull('month'), fn ($q) => $q->whereDate('month', $month))
            ->first();

        if (($data['amount'] ?? null) === null) {
            $existing?->delete();

            return ApiResponse::noContent('Budget removed');
        }

        $budget = $existing
            ? tap($existing)->update(['amount' => $data['amount']])
            : ExpenseBudget::query()->create([
                'expense_category_id' => $data['expense_category_id'],
                'branch_id' => $branchId,
                'amount' => $data['amount'],
                'month' => $month,
            ]);

        return ApiResponse::ok($budget->load('category:id,name'), 'Budget saved');
    }
}
