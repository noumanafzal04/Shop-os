<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Pos\CloseCashSessionAction;
use App\Actions\Pos\RecordCashMovementAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Pos\ShiftSyncRequest;
use App\Models\CashMovement;
use App\Models\CashSession;
use App\Models\PosDevice;
use App\Models\Register;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Throwable;

/**
 * Where shifts opened, moved and counted with no server arrive.
 *
 * ── Why this exists at all ──────────────────────────────────────────────
 *
 * The till was built to trade through an outage and then put the whole
 * capability behind a gate that needed the server: no shift, no tender. A shop
 * whose line was already down at opening time could not start a shift, so it
 * could not sell — on the morning the feature exists for. And a shift that ran
 * through an outage could not be counted out until the line came back.
 *
 * ── It records, it does not approve ─────────────────────────────────────
 *
 * The same rule as the sale endpoint beside it, and for the same reason: the
 * money has already gone into a physical drawer. Opening a shift has real
 * invariants — one open shift per lane, one per cashier — and a shift opened
 * offline can break them, because the lane was taken by somebody who got back
 * online first. Refusing it on arrival would orphan every sale rung into it and
 * leave a counted drawer belonging to nothing.
 *
 * So the conflict is written to `offline_violations` and the shift is recorded.
 * Nothing is corrected.
 *
 * ── Order is the caller's job, and it matters ───────────────────────────
 *
 * Operations are applied in the order given. The till sends them in the order
 * they happened, and flushes them around the sale queue: **opens first, so the
 * sales have a shift to name; closes last, so the drawer is counted against
 * every sale that belongs inside it.** A close that overtook its own sales
 * would report a variance the size of the takings.
 */
class PosShiftSyncController extends Controller
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly BranchContext $branch,
        private readonly CloseCashSessionAction $close,
        private readonly RecordCashMovementAction $movement,
    ) {}

    public function store(ShiftSyncRequest $request): JsonResponse
    {
        $data = $request->validated();
        $device = isset($data['device_id']) ? PosDevice::query()->find($data['device_id']) : null;

        $results = [];
        foreach ($data['operations'] as $operation) {
            $results[] = $this->apply($operation, $device);
        }

        return ApiResponse::ok([
            'results' => $results,
            'accepted' => count(array_filter($results, fn (array $r): bool => $r['status'] !== 'failed')),
        ], 'Synced');
    }

    /**
     * One operation. Never throws — a failure is a RESULT.
     *
     * The till has to know which of its operations landed. An exception here
     * would tell it nothing about the rest of the batch, and it would send the
     * whole lot again.
     */
    private function apply(array $operation, ?PosDevice $device): array
    {
        try {
            return match ($operation['kind']) {
                'open' => $this->open($operation, $device),
                'movement' => $this->move($operation),
                'close' => $this->closeShift($operation),
            };
        } catch (Throwable $e) {
            return $this->failed($operation['op'], $e->getMessage());
        }
    }

    /**
     * A shift that was opened at the counter with no server.
     *
     * The id came from the till, so a replay finds the session already here and
     * costs a lookup rather than a second drawer.
     */
    private function open(array $operation, ?PosDevice $device): array
    {
        $existing = CashSession::query()->find($operation['session_id']);
        if ($existing !== null) {
            return $this->done('duplicate', $operation['op'], $existing);
        }

        $openedAt = Carbon::parse($operation['at']);
        $register = isset($operation['register_id'])
            ? Register::query()->find($operation['register_id'])
            : null;

        $violations = $this->openConflicts($register, $operation);

        $session = new CashSession;
        // The till's id, not a fresh one — the queued sales already name it.
        $session->id = $operation['session_id'];
        $session->tenant_id = $this->tenant->id();
        $session->branch_id = $register?->branch_id ?? $this->branch->scopeId();
        $session->register_id = $register?->id;
        $session->user_id = auth()->id();
        $session->status = 'open';
        // Practice is fixed at open and never inferred later — a real shift
        // must not become a practice one by anything that arrives afterwards.
        $session->is_training = (bool) ($operation['is_training'] ?? false);
        $session->opening_float = (float) $operation['opening_float'];
        $session->opening_denominations = $operation['denominations'] ?? null;
        // WHEN it was opened, not when it arrived. A shift opened Tuesday and
        // synced Friday belongs to Tuesday, and taking the arrival time would
        // move a whole day's takings into the wrong trading day — silently,
        // because the figures would still add up.
        $session->opened_at = $openedAt;
        $session->synced_at = now();
        $session->pos_device_id = $device?->id;
        $session->offline_violations = $violations === [] ? null : $violations;
        $session->save();

        return $this->done('applied', $operation['op'], $session, $violations);
    }

    /**
     * The rules this shift broke by existing.
     *
     * Reported, never enforced. Both of these are real problems for a shop and
     * neither is fixable here: the drawer has already been used.
     */
    private function openConflicts(?Register $register, array $operation): array
    {
        $violations = [];

        if ($register !== null) {
            $held = CashSession::query()
                ->with('user:id,name')
                ->where('register_id', $register->id)
                ->where('status', 'open')
                ->first();

            if ($held !== null) {
                $violations[] = "{$register->name} already had an open shift"
                    .($held->user?->name !== null ? " ({$held->user->name})" : '')
                    .' when this one was opened offline. Two drawers on one lane cannot both be counted.';
            }
        }

        $mine = CashSession::query()
            ->where('user_id', auth()->id())
            ->where('status', 'open')
            ->first();

        if ($mine !== null) {
            $violations[] = 'This cashier already had an open shift when this one was opened offline.';
        }

        return $violations;
    }

    /** Cash in or out of the drawer, recorded late. */
    private function move(array $operation): array
    {
        $session = CashSession::query()->find($operation['session_id']);

        if ($session === null) {
            // Its shift has not arrived. The till sends opens first, so this is
            // a batch that was split or reordered — retryable, because the next
            // flush will carry the open.
            return $this->failed($operation['op'], 'The shift this belongs to has not arrived yet.', true);
        }

        $existing = CashMovement::query()
            ->where('idempotency_key', $operation['op'])
            ->first();

        if ($existing !== null) {
            return $this->done('duplicate', $operation['op'], $session);
        }

        $this->movement->execute(
            auth()->user(),
            [
                'type' => $operation['type'],
                'amount' => $operation['amount'] ?? null,
                'reason' => $operation['reason'] ?? null,
                'note' => $operation['note'] ?? null,
                'idempotency_key' => $operation['op'],
                'created_at' => Carbon::parse($operation['at']),
            ],
            $session,
            // The drawer ceiling is a live control: it exists so a cashier is
            // told to drop cash BEFORE the box holds too much. Enforcing it on
            // arrival would refuse a movement that already happened, hours ago,
            // and refusing it is the one thing that cannot help.
            enforceDrawerLimit: false,
        );

        return $this->done('applied', $operation['op'], $session->refresh());
    }

    /**
     * The drawer counted out with no server.
     *
     * The figures are recomputed here from what the server actually holds, not
     * taken from the till: `counted_cash` is the only number a cashier owns,
     * and everything it is compared against is the shop's own record.
     */
    private function closeShift(array $operation): array
    {
        $session = CashSession::query()->find($operation['session_id']);

        if ($session === null) {
            return $this->failed($operation['op'], 'The shift this belongs to has not arrived yet.', true);
        }

        if (! $session->isOpen()) {
            return $this->done('duplicate', $operation['op'], $session);
        }

        $closed = $this->close->execute(
            $session,
            (float) $operation['counted_cash'],
            $operation['notes'] ?? null,
            auth()->id(),
            [
                'denominations' => $operation['denominations'] ?? null,
                'declared_tenders' => $operation['declared_tenders'] ?? null,
            ],
        );

        // WHEN the drawer was counted, not when it reached us.
        $closed->forceFill(['closed_at' => Carbon::parse($operation['at'])])->save();

        return $this->done('applied', $operation['op'], $closed);
    }

    private function done(string $status, string $op, CashSession $session, array $violations = []): array
    {
        return [
            'op' => $op,
            'status' => $status,
            'session_id' => $session->id,
            'shift_status' => $session->status,
            'violations' => $violations,
        ];
    }

    private function failed(string $op, string $message, bool $retryable = false): array
    {
        return [
            'op' => $op,
            'status' => 'failed',
            'session_id' => null,
            'shift_status' => null,
            'violations' => [],
            'message' => $message,
            'retryable' => $retryable,
        ];
    }
}
