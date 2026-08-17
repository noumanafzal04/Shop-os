<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Income\PostRecurringIncomeAction;
use App\Http\Controllers\Controller;
use App\Models\Income;
use App\Models\RecurringIncome;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Money that comes round again: the flat upstairs, the shutter let out, a
 * monthly supply contract, a fixed commission.
 *
 * The exact twin of RecurringExpenseController, deliberately — same shape, same
 * vocabulary, same rules. It is one problem seen from the other side of the
 * page, and a books module where the two sides behave differently is one a
 * shopkeeper stops trusting.
 *
 * These fall DUE and are posted by a person. No scheduler writes income on its
 * own: an entry that appears because a clock ticked is an entry nobody checked
 * against a payment, and rent is exactly the thing that goes unpaid quietly.
 */
class RecurringIncomeController extends Controller
{
    public function __construct(private readonly BranchContext $branch) {}

    public function index(Request $request): JsonResponse
    {
        $branchScope = $this->branch->scopeId();

        $rows = RecurringIncome::query()
            ->with('category:id,name')
            ->when($branchScope, fn ($q, $b) => $q->where('branch_id', $b))
            ->when($request->boolean('due'), fn ($q) => $q->where('is_active', true)->whereDate('next_due_on', '<=', now()))
            ->orderBy('next_due_on')
            ->get()
            ->map(fn (RecurringIncome $r) => $r->toArray() + ['is_due' => $r->isDue()]);

        return ApiResponse::ok($rows, 'OK', [
            // Counted server-side so the panel never re-derives "due" from a
            // timezone it may not share with the shop.
            'due_count' => RecurringIncome::query()
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

        $recurring = RecurringIncome::query()->create($data + ['branch_id' => $this->branch->id()]);

        return ApiResponse::created($recurring->load('category:id,name'), 'Recurring income added');
    }

    public function update(Request $request, string $id): JsonResponse
    {
        abort_unless($request->user()->hasPermission(Permissions::EXPENSES_MANAGE), 403);

        /** @var RecurringIncome $recurring */
        $recurring = RecurringIncome::query()->findOrFail($id);
        $recurring->update($this->validated($request, creating: false));

        return ApiResponse::ok($recurring->load('category:id,name'), 'Recurring income updated');
    }

    public function destroy(string $id): JsonResponse
    {
        RecurringIncome::query()->findOrFail($id)->delete();

        return ApiResponse::noContent('Recurring income removed');
    }

    /** Confirm what actually arrived and file it. See PostRecurringIncomeAction. */
    public function post(Request $request, string $id, PostRecurringIncomeAction $action): JsonResponse
    {
        abort_unless($request->user()->hasPermission(Permissions::EXPENSES_MANAGE), 403);

        $overrides = $request->validate([
            // Overridable, and it matters more here than on the expense side:
            // a tenant who pays short HAS paid short, and forcing the agreed
            // figure files a receipt for money nobody received.
            'amount' => ['nullable', 'numeric', 'min:0.01', 'max:99999999'],
            'income_date' => ['nullable', 'date', 'before_or_equal:today'],
            'payment_method' => ['nullable', Rule::in(Income::PAYMENT_METHODS)],
            'reference' => ['nullable', 'string', 'max:64'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);

        /** @var RecurringIncome $recurring */
        $recurring = RecurringIncome::query()->findOrFail($id);

        $result = $action->execute($request->user(), $recurring, array_filter($overrides, fn ($v) => $v !== null));

        return response()->json([
            'success' => true,
            'message' => 'Income posted',
            'data' => $result['income'],
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
            'income_category_id' => [
                'nullable', 'uuid',
                Rule::exists('income_categories', 'id')
                    ->where('tenant_id', $request->user()->tenant_id)
                    ->whereNull('deleted_at'),
            ],
            'description' => [$required, 'string', 'max:255'],
            'amount' => [$required, 'numeric', 'min:0.01', 'max:99999999'],
            'payment_method' => ['sometimes', Rule::in(Income::PAYMENT_METHODS)],
            'frequency' => [$required, Rule::in(RecurringIncome::FREQUENCIES)],
            'next_due_on' => [$required, 'date'],
            'is_active' => ['sometimes', 'boolean'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);
    }
}
