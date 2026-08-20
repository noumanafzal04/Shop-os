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
     *
     * ── Once ────────────────────────────────────────────────────────────
     *
     * A settlement is recorded once, like every sibling in this codebase: a
     * sale voids once, an order cancels once, a coupon stops at its limit, and
     * eighty-six keeps the FIRST timestamp. This one did not check, and
     * `StockDisposal::isCredited()` had been sitting there unused since the
     * day it was written — the model stated the rule and nothing asked it.
     *
     * The screen was already right, which is what made it invisible: the
     * "Credit received" button disappears the moment `credit_received_at` is
     * set, so a person clicking through the panel could never do this twice.
     * The API is the contract, though, and a retry, a double tap on a slow
     * connection or anything that is not this screen could silently replace a
     * settled money figure with a different one. The audit log would carry it;
     * the disposals list would show the second number as though it had always
     * been the first, and the distributor's worklist would not reopen.
     *
     * Refused rather than kept-first, unlike sold-out: pressing 86 twice is
     * the same intent repeated, and recording two DIFFERENT amounts is not.
     * The refusal names what is already on the row, because "409" alone
     * leaves the shop guessing whether their entry landed.
     */
    public function credit(Request $request, string $id): JsonResponse
    {
        abort_unless($request->user()->hasPermission(Permissions::INVENTORY_MANAGE), 403);

        /** @var StockDisposal $disposal */
        $disposal = StockDisposal::query()->findOrFail($id);

        abort_if($disposal->disposition !== StockDisposal::RETURNED, 422, 'Only a supplier return can be credited.');

        if ($disposal->isCredited()) {
            return ApiResponse::error(
                'This return was already credited '
                .number_format((float) $disposal->credit_received, 2)
                .' on '.$disposal->credit_received_at->toDateString().'.',
                409,
                code: 'ALREADY_CREDITED',
            );
        }

        $data = $request->validate([
            'credit_received' => ['required', 'numeric', 'min:0', 'max:99999999'],
            'credit_received_at' => ['required', 'date'],
            'credit_reference' => ['nullable', 'string', 'max:120'],
        ]);

        $disposal->update($data);

        return ApiResponse::ok($disposal->fresh(['supplier:id,name']), 'Credit recorded');
    }
}
