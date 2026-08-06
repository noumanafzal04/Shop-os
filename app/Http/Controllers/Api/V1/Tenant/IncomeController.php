<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Expense\RecordIncomeAction;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Income\StoreIncomeRequest;
use App\Models\CashMovement;
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

    public function store(StoreIncomeRequest $request, RecordIncomeAction $action): JsonResponse
    {
        $data = $request->validated() + ['branch_id' => $this->branch->id()];

        $result = $action->execute($request->user(), $data);

        return response()->json([
            'success' => true,
            'message' => 'Income recorded',
            'data' => $result['income'],
            'errors' => (object) [],
            'meta' => (object) array_filter(['warnings' => $result['warnings']]),
        ], 201);
    }

    public function update(StoreIncomeRequest $request, string $id): JsonResponse
    {
        /** @var Income $income */
        $income = Income::query()->findOrFail($id);
        $this->assertAmendable($income);

        $income->fill($request->validated())->save();

        $movement = $income->cash_movement_id !== null
            ? CashMovement::query()->whereKey($income->cash_movement_id)->first()
            : null;

        if ($movement !== null && $income->payment_method !== 'cash') {
            // Re-marked as a bank transfer: the cash never reached the till.
            $movement->delete();
            $income->forceFill(['cash_movement_id' => null])->save();
        } elseif ($movement !== null) {
            $movement->update(['amount' => (float) $income->amount, 'reason' => $income->description]);
        }

        return ApiResponse::ok($income->load('category:id,name'), 'Income updated');
    }

    public function destroy(string $id): JsonResponse
    {
        /** @var Income $income */
        $income = Income::query()->findOrFail($id);
        $this->assertAmendable($income);

        if ($income->cash_movement_id !== null) {
            CashMovement::query()->whereKey($income->cash_movement_id)->delete();
        }

        $income->delete();

        return ApiResponse::noContent('Income deleted');
    }

    /**
     * Cash that reached a drawer already counted and closed is frozen. Editing
     * it would rewrite a variance somebody signed off; the fix is a correcting
     * entry, the way a cash book has always handled yesterday.
     */
    private function assertAmendable(Income $income): void
    {
        if ($income->isSettledInAClosedShift()) {
            throw DomainException::conflict(
                'This landed in a shift that has already been counted and closed. Record a correcting entry instead.',
                'INCOME_SETTLED',
            );
        }
    }
}
