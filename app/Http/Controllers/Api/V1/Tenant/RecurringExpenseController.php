<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Expense\PostRecurringExpenseAction;
use App\Http\Controllers\Controller;
use App\Models\Expense;
use App\Models\RecurringExpense;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Costs that come round again: rent, salaries, the internet bill.
 *
 * These fall DUE and are posted by a human — no scheduler writes an expense on
 * its own. An entry that appears in the books because a clock ticked is an
 * entry nobody checked against a bill, and the amount is exactly the part that
 * moves.
 */
class RecurringExpenseController extends Controller
{
    public function __construct(private readonly BranchContext $branch) {}

    public function index(Request $request): JsonResponse
    {
        $branchScope = $this->branch->scopeId();

        $rows = RecurringExpense::query()
            ->with(['category:id,name', 'supplier:id,name'])
            ->when($branchScope, fn ($q, $b) => $q->where('branch_id', $b))
            ->when($request->boolean('due'), fn ($q) => $q->where('is_active', true)->whereDate('next_due_on', '<=', now()))
            ->orderBy('next_due_on')
            ->get()
            ->map(fn (RecurringExpense $r) => $r->toArray() + ['is_due' => $r->isDue()]);

        return ApiResponse::ok($rows, 'OK', [
            // The badge the Expense Manager shows. Counted server-side so the
            // panel never has to re-derive "due" from a timezone it may not
            // share with the shop.
            'due_count' => RecurringExpense::query()
                ->where('is_active', true)
                ->when($branchScope, fn ($q, $b) => $q->where('branch_id', $b))
                ->whereDate('next_due_on', '<=', now())
                ->count(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        abort_unless($request->user()->hasPermission(Permissions::EXPENSES_MANAGE), 403);

        $data = $this->validated($request, creating: true);

        $recurring = RecurringExpense::query()->create($data + ['branch_id' => $this->branch->id()]);

        return ApiResponse::created($recurring->load(['category:id,name', 'supplier:id,name']), 'Recurring expense added');
    }

    public function update(Request $request, string $id): JsonResponse
    {
        abort_unless($request->user()->hasPermission(Permissions::EXPENSES_MANAGE), 403);

        /** @var RecurringExpense $recurring */
        $recurring = RecurringExpense::query()->findOrFail($id);
        $recurring->update($this->validated($request, creating: false));

        return ApiResponse::ok($recurring->load(['category:id,name', 'supplier:id,name']), 'Recurring expense updated');
    }

    public function destroy(string $id): JsonResponse
    {
        RecurringExpense::query()->findOrFail($id)->delete();

        return ApiResponse::noContent('Recurring expense removed');
    }

    /** Confirm the real figure and file it. See PostRecurringExpenseAction. */
    public function post(Request $request, string $id, PostRecurringExpenseAction $action): JsonResponse
    {
        abort_unless($request->user()->hasPermission(Permissions::EXPENSES_MANAGE), 403);

        $overrides = $request->validate([
            'amount' => ['nullable', 'numeric', 'min:0.01', 'max:99999999'],
            'expense_date' => ['nullable', 'date', 'before_or_equal:today'],
            'payment_method' => ['nullable', Rule::in(Expense::PAYMENT_METHODS)],
            'reference' => ['nullable', 'string', 'max:64'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);

        /** @var RecurringExpense $recurring */
        $recurring = RecurringExpense::query()->findOrFail($id);

        $result = $action->execute($request->user(), $recurring, array_filter($overrides, fn ($v) => $v !== null));

        return response()->json([
            'success' => true,
            'message' => 'Expense posted',
            'data' => $result['expense'],
            'errors' => (object) [],
            'meta' => (object) array_filter([
                'warnings' => $result['warnings'],
                'next_due_on' => $result['template']->next_due_on?->toDateString(),
            ]),
        ], 201);
    }

    /** @return array<string, mixed> */
    private function validated(Request $request, bool $creating): array
    {
        $required = $creating ? 'required' : 'sometimes';

        return $request->validate([
            'expense_category_id' => [
                $required, 'uuid',
                Rule::exists('expense_categories', 'id')
                    ->where('tenant_id', $request->user()->tenant_id)
                    ->whereNull('deleted_at'),
            ],
            'supplier_id' => [
                'nullable', 'uuid',
                Rule::exists('suppliers', 'id')
                    ->where('tenant_id', $request->user()->tenant_id)
                    ->whereNull('deleted_at'),
            ],
            'description' => [$required, 'string', 'max:255'],
            'amount' => [$required, 'numeric', 'min:0.01', 'max:99999999'],
            'payment_method' => ['sometimes', Rule::in(Expense::PAYMENT_METHODS)],
            'frequency' => [$required, Rule::in(RecurringExpense::FREQUENCIES)],
            'next_due_on' => [$required, 'date'],
            'is_active' => ['sometimes', 'boolean'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);
    }
}
