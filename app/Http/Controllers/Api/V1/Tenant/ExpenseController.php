<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Expense\RecordExpenseAction;
use App\Actions\Expense\ReviseExpenseAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Expense\StoreExpenseRequest;
use App\Models\Expense;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class ExpenseController extends Controller
{
    public function __construct(private readonly BranchContext $branch) {}

    public function index(Request $request): JsonResponse
    {
        // Owner "all branches" (scopeId null) sees every expense; a focused
        // branch view sees only that branch's costs.
        $branchScope = $this->branch->scopeId();

        $expenses = Expense::query()
            ->with(['category:id,name', 'supplier:id,name'])
            ->when($branchScope, fn ($q, $b) => $q->where('branch_id', $b))
            ->when($request->query('search'), fn ($q, $s) => $q->where('description', 'like', "%{$s}%"))
            ->when($request->query('category_id'), fn ($q, $id) => $q->where('expense_category_id', $id))
            ->when($request->query('payment_method'), fn ($q, $m) => $q->where('payment_method', $m))
            ->when($request->query('from'), fn ($q, $from) => $q->where('expense_date', '>=', $from))
            ->when($request->query('to'), fn ($q, $to) => $q->where('expense_date', '<=', $to))
            ->orderByDesc('expense_date')
            ->orderByDesc('created_at')
            ->paginate(min((int) $request->query('per_page', 15), 100));

        return ApiResponse::paginated($expenses);
    }

    public function store(StoreExpenseRequest $request, RecordExpenseAction $action): JsonResponse
    {
        // Stamp the operating branch that incurred this cost (null = headless).
        $data = $request->validated() + ['branch_id' => $this->branch->id()];

        $result = $action->execute($request->user(), $data);

        // Warnings, not errors: a duplicate-looking bill, a budget gone past, a
        // cash payment with no shift open. All of them are things the shop needs
        // to know and none of them is a reason to refuse the record.
        return response()->json([
            'success' => true,
            'message' => 'Expense recorded',
            'data' => $result['expense'],
            'errors' => (object) [],
            'meta' => (object) array_filter(['warnings' => $result['warnings']]),
        ], 201);
    }

    public function update(StoreExpenseRequest $request, string $id, ReviseExpenseAction $action): JsonResponse
    {
        /** @var Expense $expense */
        $expense = Expense::query()->findOrFail($id);

        return ApiResponse::ok($action->update($expense, $request->validated()), 'Expense updated');
    }

    public function destroy(string $id, ReviseExpenseAction $action): JsonResponse
    {
        /** @var Expense $expense */
        $expense = Expense::query()->findOrFail($id);

        $action->delete($expense);

        return ApiResponse::noContent('Expense deleted');
    }

    /**
     * The photo of the bill.
     *
     * An expense without its receipt is an assertion; with it, it's a record —
     * which is the difference that matters when an owner reviews a month of
     * someone else's spending.
     */
    public function attach(Request $request, string $id): JsonResponse
    {
        $request->validate([
            'file' => ['required', 'file', 'mimes:jpg,jpeg,png,webp,pdf', 'max:5120'],
        ]);

        /** @var Expense $expense */
        $expense = Expense::query()->findOrFail($id);

        // Replacing an attachment removes the old file rather than orphaning it.
        if ($expense->attachment_path) {
            Storage::disk('public')->delete($expense->attachment_path);
        }

        $path = $request->file('file')->store("receipts/{$expense->tenant_id}", 'public');
        $expense->forceFill(['attachment_path' => $path])->save();

        return ApiResponse::ok($expense->fresh(['category:id,name']), 'Receipt attached');
    }

    public function detach(string $id): JsonResponse
    {
        /** @var Expense $expense */
        $expense = Expense::query()->findOrFail($id);

        if ($expense->attachment_path) {
            Storage::disk('public')->delete($expense->attachment_path);
            $expense->forceFill(['attachment_path' => null])->save();
        }

        return ApiResponse::ok($expense->fresh(), 'Receipt removed');
    }
}
