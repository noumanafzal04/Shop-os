<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Http\Requests\Expense\StoreExpenseRequest;
use App\Models\Expense;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ExpenseController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $expenses = Expense::query()
            ->with('category:id,name')
            ->when($request->query('search'), fn ($q, $s) => $q->where('description', 'like', "%{$s}%"))
            ->when($request->query('category_id'), fn ($q, $id) => $q->where('expense_category_id', $id))
            ->when($request->query('from'), fn ($q, $from) => $q->where('expense_date', '>=', $from))
            ->when($request->query('to'), fn ($q, $to) => $q->where('expense_date', '<=', $to))
            ->orderByDesc('expense_date')
            ->orderByDesc('created_at')
            ->paginate(min((int) $request->query('per_page', 15), 100));

        return ApiResponse::paginated($expenses);
    }

    public function store(StoreExpenseRequest $request): JsonResponse
    {
        $data = $request->validated();

        // Edge case "duplicate expense": same category+amount+date already
        // recorded → still allowed (rent CAN repeat) but flagged as a warning
        // the UI surfaces before the user assumes it saved twice.
        $duplicate = Expense::query()
            ->where('expense_category_id', $data['expense_category_id'])
            ->where('amount', $data['amount'])
            ->whereDate('expense_date', $data['expense_date'])
            ->exists();

        $expense = Expense::query()->create($data)->load('category:id,name');

        return response()->json([
            'success' => true,
            'message' => 'Expense recorded',
            'data' => $expense,
            'errors' => (object) [],
            'meta' => (object) array_filter([
                'warnings' => $duplicate
                    ? ['A very similar expense (same category, amount and date) already exists.']
                    : [],
            ]),
        ], 201);
    }

    public function update(StoreExpenseRequest $request, string $id): JsonResponse
    {
        $expense = Expense::query()->findOrFail($id);
        $expense->fill($request->validated())->save();

        return ApiResponse::ok($expense->load('category:id,name'), 'Expense updated');
    }

    public function destroy(string $id): JsonResponse
    {
        Expense::query()->findOrFail($id)->delete();

        return ApiResponse::noContent('Expense deleted');
    }
}
