<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Expense\RecordExpenseAction;
use App\Actions\Expense\ReviseExpenseAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Expense\StoreExpenseRequest;
use App\Models\Expense;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\CsvExport;
use App\Support\MoneyEntryFilters;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ExpenseController extends Controller
{
    public function __construct(private readonly BranchContext $branch) {}

    public function index(Request $request): JsonResponse
    {
        $query = $this->filtered($request)->with(['category:id,name', 'supplier:id,name']);

        // What the filtered set adds up to, alongside the page of rows. A
        // merchant who narrows to "rent, this quarter" is asking a question
        // whose answer is the total — making them add up three pages by hand
        // is the difference between a book and a list.
        $totals = MoneyEntryFilters::totals($query);

        $expenses = $query->paginate(min((int) $request->query('per_page', 15), 100));

        return ApiResponse::paginated($expenses, 'OK', ['totals' => $totals]);
    }

    /**
     * The filtered rows as a CSV — the same query the merchant is looking at,
     * not an approximation of it, so what they hand their accountant matches
     * what they saw on screen.
     */
    public function export(Request $request): StreamedResponse
    {
        $rows = $this->filtered($request)
            ->with(['category:id,name', 'supplier:id,name'])
            ->get()
            ->map(fn (Expense $e): array => [
                $e->expense_date?->toDateString(),
                $e->category?->name,
                $e->description,
                $e->reference,
                $e->supplier?->name,
                $e->payment_method,
                $e->amount,
                $e->notes,
            ])
            ->all();

        return CsvExport::stream(
            'expenses-'.now()->format('Y-m-d').'.csv',
            ['Date', 'Category', 'Description', 'Reference', 'Paid to', 'Method', 'Amount', 'Notes'],
            $rows,
        );
    }

    /**
     * Owner "all branches" (scopeId null) sees every expense; a focused branch
     * view sees only that branch's costs.
     *
     * @return Builder<Expense>
     */
    private function filtered(Request $request): Builder
    {
        $branchScope = $this->branch->scopeId();

        return MoneyEntryFilters::apply(
            Expense::query()->when($branchScope, fn ($q, $b) => $q->where('branch_id', $b)),
            $request,
            'expense_date',
            'expense_category_id',
        );
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
