<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Sale\CreateSaleAction;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Pos\SyncRequest;
use App\Models\CashSession;
use App\Models\PosDevice;
use App\Models\Sale;
use App\Support\ApiResponse;
use App\Support\OfflinePolicy;
use App\Support\PlanLimits;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Throwable;

/**
 * Where sales rung with no server arrive.
 *
 * ── The endpoint's job is NOT to approve ────────────────────────────────
 *
 * The money already crossed the counter. Nothing here can un-ring a sale, so
 * this does not decide whether it should have happened — it records what DID
 * happen and reports what differs. Everything below follows from that:
 *
 *   • Out of stock does not refuse. It sells to negative and the oversell is
 *     listed for the owner. Refusing would delete the record of goods that have
 *     already left the shop.
 *   • Past the offline window does not refuse. It is marked.
 *   • A policy violation does not refuse, and is never CORRECTED. Rewriting a
 *     credit sale into a cash one would leave a shop believing it had been
 *     paid, which is worse than any refusal. It is flagged for review.
 *
 * ── Per operation, never per batch ──────────────────────────────────────
 *
 * One bad operation in fifty must not cost the other forty-nine. Each runs in
 * its own transaction and reports its own result, so a till can retire exactly
 * what landed and retry exactly what did not — the difference between a shop
 * losing one sale and a shop losing a day.
 *
 * ── Replay ──────────────────────────────────────────────────────────────
 *
 * `op` is the idempotency key, minted on the device when the cashier hit
 * Complete. A lost acknowledgement means the till sends it again, and it must
 * get the SAME sale back rather than a second one — the shop would otherwise
 * bank the same money twice for the price of one dropped packet.
 */
class PosSyncController extends Controller
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly CreateSaleAction $createSale,
    ) {}

    public function store(SyncRequest $request): JsonResponse
    {
        $data = $request->validated();
        $device = $this->device($data['device_id'] ?? null);
        $windowDays = PlanLimits::limit($this->tenant->get(), 'offline_days');

        $results = [];
        foreach ($data['operations'] as $operation) {
            $results[] = $this->apply($operation, $device, $windowDays);
        }

        return ApiResponse::ok([
            'results' => $results,
            'accepted' => count(array_filter($results, fn (array $r): bool => $r['status'] !== 'failed')),
        ], 'Synced');
    }

    /**
     * One operation, in its own transaction.
     *
     * Never throws. A failure is a RESULT — the till needs to know which of its
     * fifty landed, and an exception here would tell it nothing about the other
     * forty-nine.
     */
    private function apply(array $operation, ?PosDevice $device, ?int $windowDays): array
    {
        $sale = $operation['sale'];
        $soldAt = Carbon::parse($operation['at']);

        // Already here? Then this is a retry after a lost acknowledgement, and
        // the till gets the original back. Checked before anything else: a
        // replay must cost a lookup, never a second attempt at the work.
        $existing = Sale::query()->where('idempotency_key', $operation['op'])->first();
        if ($existing !== null) {
            return $this->done('duplicate', $operation['op'], $existing);
        }

        $violations = OfflinePolicy::violations($sale);

        $trainingSplit = $this->trainingDisagreement($sale, $operation);
        if ($trainingSplit !== null) {
            $violations[] = $trainingSplit;
        }

        try {
            $created = $this->createSale->execute($sale + [
                'idempotency_key' => $operation['op'],
                // The moment the money crossed the counter — which decides the
                // trading day, the shift and whose figures this lands in. Never
                // the moment it reached us.
                'sold_at' => $soldAt,
                'offline_number' => $operation['offline_number'] ?? null,
                'pos_device_id' => $device?->id,
                'beyond_offline_window' => $this->beyondWindow($soldAt, $operation, $windowDays),
                'offline_violations' => $violations === [] ? null : $violations,
                // Half of the practice test. The shift is the other half, and
                // this can only ever say NO — see the veto in CreateSaleAction.
                'offline_training' => (bool) ($operation['training'] ?? false),
                // Trusted about WHEN and WHICH DEVICE. Emphatically not
                // trusted about money: the server prices this cart itself,
                // exactly as it would have online. That is the whole point of
                // Phase 2 — the till's figure was only ever a receipt.
                'trusted_offline' => true,
                // Dead today, and deliberately kept. `SyncRequest` borrows a
                // rule set with no `unit_price`, so no price ever reaches here
                // and flipping this line changes nothing — a mutation proved
                // exactly that, staying green on its own.
                //
                // It is the SECOND of two layers, and it earns its place the
                // day somebody adds a `unit_price` rule to the shared sale
                // request for the online path and never thinks about this one.
                // Mutating both at once IS caught.
                'trusted_prices' => false,
            ]);

            return $this->done('applied', $operation['op'], $created, $violations);
        } catch (DomainException $e) {
            // Something the shop can act on — a product deleted since, a
            // discount over the ceiling, a customer removed. The sale stays in
            // the till's outbox marked for attention rather than retrying for
            // ever against an answer that will not change.
            return $this->failed($operation['op'], $e->getMessage(), $e->errorCode);
        } catch (Throwable $e) {
            // Anything else. Retryable, because it may be transient.
            report($e);

            return $this->failed($operation['op'], 'This sale could not be recorded. It is still safe on the till.', 'SYNC_FAILED', retryable: true);
        }
    }

    /**
     * The drawer and the till disagreeing about whether this was practice.
     *
     * They should never disagree. The till was standing at that shift when it
     * rang the sale, so it knew. A disagreement means either the shift was
     * changed after the fact, or the operation was — and both are worth an
     * owner's eye however innocent the cause.
     *
     * Either way the sale is recorded as REAL, which is what both sentences
     * below say out loud. Reporting a difference the shop cannot see the
     * consequence of is how a flag gets ignored.
     */
    private function trainingDisagreement(array $sale, array $operation): ?string
    {
        if (empty($sale['cash_session_id'])) {
            return null;
        }

        $drawer = (bool) CashSession::query()
            ->whereKey($sale['cash_session_id'])
            ->value('is_training');
        $till = (bool) ($operation['training'] ?? false);

        if ($drawer === $till) {
            return null;
        }

        return $drawer
            ? 'This sale names a practice shift, but the till that rang it was not in practice mode. It has been recorded as a real sale.'
            : 'The till called this a practice sale, but the shift it names is a real one. It has been recorded as a real sale.';
    }

    /**
     * Was this rung after the shop's allowed days had run out?
     *
     * The question is "how long had this till been away WHEN IT RANG THIS",
     * not "how old is this sale now" — so it is measured from the device's own
     * last contact, which the operation carries.
     *
     * A till that went dark on the 1st and rang this on the 2nd was one day
     * out, and stays one day out however long its outbox then sat waiting for
     * a line. Measuring from today instead would condemn every sale a long
     * outage produced, including the ones rung well inside the shop's rules,
     * and a report where everything is flagged is a report nobody reads.
     */
    private function beyondWindow(Carbon $soldAt, array $operation, ?int $windowDays): bool
    {
        if ($windowDays === null || empty($operation['offline_since'])) {
            return false;
        }

        return Carbon::parse($operation['offline_since'])->diffInDays($soldAt) > $windowDays;
    }

    /** The device that rang these, when we know it. Never fatal. */
    private function device(?string $id): ?PosDevice
    {
        return $id === null ? null : PosDevice::query()->find($id);
    }

    private function done(string $status, string $op, Sale $sale, array $violations = []): array
    {
        return [
            'op' => $op,
            'status' => $status,
            'sale_id' => $sale->id,
            // The real number, so the till can reconcile the slip it printed.
            'invoice_number' => $sale->invoice_number,
            'offline_number' => $sale->offline_number,
            'violations' => $violations,
        ];
    }

    private function failed(string $op, string $message, ?string $code, bool $retryable = false): array
    {
        return [
            'op' => $op,
            'status' => 'failed',
            'sale_id' => null,
            'invoice_number' => null,
            'offline_number' => null,
            'message' => $message,
            'code' => $code,
            // Whether sending it again could ever give a different answer. A
            // till that retries a permanent failure for ever never empties its
            // queue and never tells anyone why.
            'retryable' => $retryable,
        ];
    }
}
