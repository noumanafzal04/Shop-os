<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Models\StockDisposal;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * What left the shelf without being sold, and what is owed back for it.
 *
 * Two questions, and the whole point is that they are answered separately:
 *
 *   "What did expiry cost me?"     — written-off rows, totalled. A real loss.
 *   "What has X not credited yet?" — returned rows with no credit date. Money
 *                                    that is neither lost nor recovered, and
 *                                    only recovered if somebody chases it.
 *
 * Summing the two would produce a loss figure overstated by everything the
 * distributor is about to pay back.
 */
class StockDisposalController extends Controller
{
    public function index(Request $request, BranchContext $branch): JsonResponse
    {
        $data = $request->validate([
            'disposition' => ['sometimes', Rule::in(StockDisposal::DISPOSITIONS)],
            'reason' => ['sometimes', Rule::in(StockDisposal::REASONS)],
            'supplier_id' => ['sometimes', 'uuid'],
            // The claims list: sent back, nothing credited.
            'awaiting_credit' => ['sometimes', 'boolean'],
            'from' => ['sometimes', 'date'],
            'to' => ['sometimes', 'date', 'after_or_equal:from'],
        ]);

        $rows = StockDisposal::query()
            ->with(['supplier:id,name', 'createdBy:id,name'])
            // scopeId(), not id(): this is a READ, and null is an owner looking
            // at every branch at once.
            ->when($branch->scopeId(), fn ($q, $id) => $q->where('branch_id', $id))
            ->when(isset($data['disposition']), fn ($q) => $q->where('disposition', $data['disposition']))
            ->when(isset($data['reason']), fn ($q) => $q->where('reason', $data['reason']))
            ->when(isset($data['supplier_id']), fn ($q) => $q->where('supplier_id', $data['supplier_id']))
            ->when($request->boolean('awaiting_credit'), fn ($q) => $q->awaitingCredit())
            ->when(isset($data['from']), fn ($q) => $q->whereDate('disposed_at', '>=', $data['from']))
            ->when(isset($data['to']), fn ($q) => $q->whereDate('disposed_at', '<=', $data['to']))
            ->orderByDesc('disposed_at')
            ->paginate(30);

        return ApiResponse::paginated($rows);
    }

    /**
     * The distributor settled a claim.
     *
     * A separate, deliberate act rather than something the return could have
     * assumed: the credit arrives on the distributor's schedule, for whatever
     * they decide it is worth, and often for less than was claimed. Recording
     * it at return time would put money in the shop's books that nobody had
     * agreed to.
     *
     * The AMOUNT is recorded as what actually came, not as what was expected —
     * the gap between the two is the number worth reading.
     */
    public function credit(Request $request, string $id): JsonResponse
    {
        abort_unless($request->user()->hasPermission(Permissions::INVENTORY_MANAGE), 403);

        /** @var StockDisposal $disposal */
        $disposal = StockDisposal::query()->findOrFail($id);

        abort_if($disposal->disposition !== StockDisposal::RETURNED, 422, 'Only a supplier return can be credited.');

        $data = $request->validate([
            'credit_received' => ['required', 'numeric', 'min:0', 'max:99999999'],
            'credit_received_at' => ['required', 'date'],
            'credit_reference' => ['nullable', 'string', 'max:120'],
        ]);

        $disposal->update($data);

        return ApiResponse::ok($disposal->fresh(['supplier:id,name']), 'Credit recorded');
    }
}
