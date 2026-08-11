<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Expense\RecordIncomeAction;
use App\Actions\Pos\RecordCashMovementAction;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Income\StoreIncomeRequest;
use App\Models\CashMovement;
use App\Models\Income;
use App\Support\ApiResponse;
use App\Support\BooksDrawer;
use App\Support\BranchContext;
use App\Support\CsvExport;
use App\Support\MoneyEntryFilters;
use App\Support\ReceiptFiles;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

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
        $query = $this->filtered($request)->with('category:id,name');
        $totals = MoneyEntryFilters::totals($query);

        $incomes = $query->paginate(min((int) $request->query('per_page', 15), 100));

        return ApiResponse::paginated($incomes, 'OK', ['totals' => $totals]);
    }

    /** The filtered rows as a CSV — see ExpenseController::export. */
    public function export(Request $request): StreamedResponse
    {
        $rows = $this->filtered($request)
            ->with('category:id,name')
            ->get()
            ->map(fn (Income $i): array => [
                $i->income_date?->toDateString(),
                $i->category?->name,
                $i->description,
                $i->reference,
                $i->payment_method,
                $i->amount,
                $i->notes,
            ])
            ->all();

        return CsvExport::stream(
            'income-'.now()->format('Y-m-d').'.csv',
            ['Date', 'Category', 'Description', 'Reference', 'Method', 'Amount', 'Notes'],
            $rows,
        );
    }

    /** @return Builder<Income> */
    private function filtered(Request $request): Builder
    {
        $branchScope = $this->branch->scopeId();

        return MoneyEntryFilters::apply(
            Income::query()->when($branchScope, fn ($q, $b) => $q->where('branch_id', $b)),
            $request,
            'income_date',
            'income_category_id',
        );
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

    public function update(StoreIncomeRequest $request, string $id, RecordCashMovementAction $cash): JsonResponse
    {
        /** @var Income $income */
        $income = Income::query()->findOrFail($id);
        $this->assertAmendable($income);

        $wasCash = $income->payment_method === 'cash';
        $income->fill($request->validated())->save();

        $movement = $income->cash_movement_id !== null
            ? CashMovement::query()->whereKey($income->cash_movement_id)->first()
            : null;

        $warnings = [];

        if ($movement !== null && $income->payment_method !== 'cash') {
            // Re-marked as a bank transfer: the cash never reached the till.
            $movement->delete();
            $income->forceFill(['cash_movement_id' => null])->save();
        } elseif ($movement !== null) {
            $movement->update(['amount' => (float) $income->amount, 'reason' => $income->description]);
        } elseif (! $wasCash && $income->payment_method === 'cash') {
            // Corrected to cash: the money IS in a drawer, so one has to move.
            // See ReviseExpenseAction — the same gap, the same fix, and the
            // same rule about whose drawer it may be.
            $practice = BooksDrawer::isPractice($request->user());
            $created = $practice ? null : $cash->record($request->user(), [
                'type' => 'income_in',
                'amount' => (float) $income->amount,
                'reason' => $income->description,
                'source_type' => 'income',
                'source_id' => $income->id,
            ]);

            if ($created !== null) {
                $income->forceFill(['cash_movement_id' => $created->id])->save();
            } else {
                $warnings[] = BooksDrawer::untouchedDrawerWarning($practice, 'Changed to cash');
            }
        }

        return response()->json([
            'success' => true,
            'message' => 'Income updated',
            'data' => $income->load('category:id,name'),
            'errors' => (object) [],
            'meta' => (object) array_filter(['warnings' => $warnings]),
        ]);
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
     * The proof the money came in.
     *
     * Expenses have had this since the module shipped; income had the column
     * and nothing else, so the one side of the book an owner is most likely to
     * question — "what was this Rs 80,000?" — was the side with no evidence.
     * Deliberately NOT blocked by assertAmendable(): attaching a receipt to a
     * settled entry changes no money, and refusing it would leave a closed
     * shift permanently unevidenced.
     */
    public function attach(Request $request, string $id): JsonResponse
    {
        $request->validate([
            'file' => ['required', 'file', 'mimes:jpg,jpeg,png,webp,pdf', 'max:5120'],
        ]);

        /** @var Income $income */
        $income = Income::query()->findOrFail($id);

        // Replacing an attachment removes the old file rather than orphaning it.
        ReceiptFiles::delete($income->attachment_path);

        $path = ReceiptFiles::store($request->file('file'), $income->tenant_id);
        $income->forceFill(['attachment_path' => $path])->save();

        return ApiResponse::ok($income->fresh(['category:id,name']), 'Receipt attached');
    }

    /** See ExpenseController::attachment — same rule, other side of the book. */
    public function attachment(string $id): StreamedResponse|JsonResponse
    {
        /** @var Income $income */
        $income = Income::query()->findOrFail($id);

        if ($income->attachment_path === null) {
            return ApiResponse::notFound('No receipt is attached to this income entry.');
        }

        return ReceiptFiles::response($income->attachment_path)
            ?? ApiResponse::notFound('That receipt file is missing from storage.');
    }

    public function detach(string $id): JsonResponse
    {
        /** @var Income $income */
        $income = Income::query()->findOrFail($id);

        if ($income->attachment_path) {
            ReceiptFiles::delete($income->attachment_path);
            $income->forceFill(['attachment_path' => null])->save();
        }

        return ApiResponse::ok($income->fresh(), 'Receipt removed');
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
