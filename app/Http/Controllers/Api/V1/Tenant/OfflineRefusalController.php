<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Models\OfflineRefusal;
use App\Models\Sale;
use App\Models\User;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * SETTLING A REFUSED OFFLINE SALE (B49).
 *
 * The money is in the drawer and the shop has no sale for it. A person at the
 * till says what became of it, and it is written down with their name:
 *
 *   rung_again   rung at the till as a real sale — which one is named, so the
 *                drawer's cash now has a sale against it;
 *   dealt_with   anything else — the money handed back, a sale written by
 *                hand — and then a note is required, because "dealt with" with
 *                no word of how is the same silence this exists to end.
 *
 * Sent twice (a retry after a lost answer) it is the same settlement; settled
 * one way it cannot be settled another. A refusal from before the shop kept
 * them is written from the till's own copy the first time it is settled.
 *
 * A note written with no line is sent by whoever's login reconnects, so the
 * till names the person who wrote it (`settled_by`) — checked the way the
 * sync checks `rung_by`.
 */
class OfflineRefusalController extends Controller
{
    public function __construct(private readonly TenantContext $tenant) {}

    public function settle(Request $request, BranchContext $branch, string $op): JsonResponse
    {
        $data = $request->validate([
            'how' => ['required', Rule::in([OfflineRefusal::RUNG_AGAIN, OfflineRefusal::DEALT_WITH])],
            'note' => ['nullable', 'required_if:how,'.OfflineRefusal::DEALT_WITH, 'string', 'min:3', 'max:255'],
            'sale_id' => ['nullable', 'required_if:how,'.OfflineRefusal::RUNG_AGAIN, 'uuid'],
            'settled_by' => ['nullable', 'uuid'],
            // The till's own copy, for a refusal the shop never kept.
            'offline_number' => ['nullable', 'string', 'max:64'],
            'sold_at' => ['nullable', 'date'],
            'till_total' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            'reason' => ['nullable', 'string', 'max:2000'],
        ]);

        $sale = $data['how'] === OfflineRefusal::RUNG_AGAIN ? Sale::query()->findOrFail($data['sale_id']) : null;

        $refusal = DB::transaction(function () use ($data, $op, $sale, $branch, $request): OfflineRefusal {
            $refusal = OfflineRefusal::query()->where('op', $op)->lockForUpdate()->first()
                ?? OfflineRefusal::query()->create([
                    'op' => $op,
                    'branch_id' => $branch->id(),
                    'offline_number' => $data['offline_number'] ?? null,
                    'sold_at' => $data['sold_at'] ?? null,
                    'rung_by' => $request->user()->id,
                    'till_total' => $data['till_total'] ?? null,
                    'reason' => $data['reason'] ?? 'Refused before the shop kept a record of refusals.',
                    'refused_at' => now(),
                ]);

            if ($refusal->settled_as !== null) {
                $same = $refusal->settled_as === $data['how'] && $refusal->sale_id === $sale?->id;
                if ($same) {
                    return $refusal;
                }

                throw DomainException::conflict(
                    "{$this->label($refusal)} was already settled.",
                    'REFUSAL_SETTLED',
                );
            }

            // One sale stands for one refused sale: two slips cannot both be
            // "rung again" as the same receipt.
            if ($sale !== null && OfflineRefusal::query()->where('sale_id', $sale->id)->exists()) {
                throw DomainException::conflict(
                    "{$sale->invoice_number} already stands for another refused sale.",
                    'SALE_ALREADY_SETTLES',
                );
            }

            $refusal->forceFill([
                'settled_as' => $data['how'],
                'settled_note' => $data['note'] ?? null,
                'settled_by' => $this->settledBy($request, $data['settled_by'] ?? null),
                'settled_at' => now(),
                'sale_id' => $sale?->id,
            ])->save();

            return $refusal;
        });

        return ApiResponse::ok($refusal->load('sale:id,invoice_number'), 'Settled');
    }

    /** A live user of this shop, or whoever sent it — never a stranger's id. */
    private function settledBy(Request $request, ?string $named): string
    {
        $user = $named === null ? null : User::query()->where('tenant_id', $this->tenant->id())->find($named);

        return $user?->isActive() === true ? $user->id : $request->user()->id;
    }

    private function label(OfflineRefusal $refusal): string
    {
        return $refusal->offline_number ?? 'This sale';
    }
}
