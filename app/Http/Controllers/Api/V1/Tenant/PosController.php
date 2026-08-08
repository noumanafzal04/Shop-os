<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Pos\CloseCashSessionAction;
use App\Actions\Pos\MoveCashSessionAction;
use App\Actions\Pos\OpenCashSessionAction;
use App\Actions\Pos\RecordCashMovementAction;
use App\Actions\Pos\ReliefCoverAction;
use App\Enums\SaleStatus;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Models\CashMovement;
use App\Models\CashSession;
use App\Models\CashSessionCover;
use App\Models\HeldSale;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\ProductUnit;
use App\Models\ProductVariant;
use App\Models\Register;
use App\Models\SaleItem;
use App\Models\User;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\DenominationCount;
use App\Support\DrawerMath;
use App\Support\Permissions;
use App\Support\RegisterContext;
use App\Support\ScaleBarcode;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class PosController extends Controller
{
    /**
     * Scan/lookup by barcode or SKU. Matches a product's own code, or a
     * variant's SKU (returning the parent product with the variant preselected).
     */
    public function __construct(
        private readonly TenantContext $context,
        private readonly BranchContext $branch,
        private readonly RegisterContext $terminal,
    ) {}

    public function lookup(Request $request): JsonResponse
    {
        $code = trim((string) $request->query('code'));
        if ($code === '') {
            throw DomainException::unprocessable('No code provided.', 'POS_NO_CODE');
        }

        // Scale (embedded-weight) barcode? A grocery scale's label carries the
        // item's PLU code + the weighed amount. When the shop has this on, we
        // resolve the product by PLU and hand back the pre-filled quantity so
        // the cashier doesn't type the weight. Falls through to a normal lookup
        // if it isn't a scale barcode.
        $scale = ScaleBarcode::parse($code, $this->context->get()?->allSettings() ?? []);
        if ($scale !== null) {
            return $this->scaleLookup($scale);
        }

        $product = Product::query()
            ->with(['variants', 'images', 'modifierGroups.options', 'units', 'comboItems.component:id,name', 'recipeItems.ingredient:id,name'])
            ->where('is_active', true)
            ->where(fn ($q) => $q->where('barcode', $code)->orWhere('sku', $code)
                ->orWhereHas('barcodes', fn ($b) => $b->where('barcode', $code)))
            ->first();

        $variantId = null;
        $unitId = null;
        if ($product === null) {
            // Fall back to a variant SKU, or an alternate barcode tied to a variant.
            $variant = ProductVariant::query()->where('sku', $code)->where('is_active', true)->first()
                ?? ProductBarcode::query()->where('barcode', $code)->whereNotNull('variant_id')->first()?->variant;
            if ($variant !== null) {
                $product = Product::query()->with(['variants', 'images', 'modifierGroups.options', 'units', 'comboItems.component:id,name', 'recipeItems.ingredient:id,name'])->find($variant->product_id);
                $variantId = $variant->id;
            }
        }

        if ($product === null) {
            // A pack (strip/box) can carry its own barcode — scanning it should
            // preselect that pack on the line.
            $unit = ProductUnit::query()->where('barcode', $code)->first();
            if ($unit !== null) {
                $product = Product::query()->with(['variants', 'images', 'modifierGroups.options', 'units', 'comboItems.component:id,name', 'recipeItems.ingredient:id,name'])
                    ->where('is_active', true)->find($unit->product_id);
                $unitId = $product !== null ? $unit->id : null;
            }
        }

        if ($product === null) {
            throw DomainException::unprocessable('No item found for that code.', 'POS_ITEM_NOT_FOUND');
        }

        return ApiResponse::ok([
            'product' => $product,
            'variant_id' => $variantId,
            // Preselected pack when a pack barcode was scanned (else null = base unit).
            'product_unit_id' => $unitId,
            // POS cashier warnings: Rx items + stock nearing expiry (earliest
            // non-expired batch within 90 days). Never blocks the sale.
            'requires_prescription' => (bool) $product->requires_prescription,
            'near_expiry' => $this->nearExpiry($product),
        ]);
    }

    /**
     * Resolve a parsed scale barcode to its product (by PLU) and the quantity
     * to add. Weight mode fills the weighed kg directly; price mode back-solves
     * the weight from the shop's own per-unit price so the total the customer
     * pays still comes from the server, matching the printed price.
     *
     * @param  array{item_code: string, mode: string, weight: float|null, price: float|null}  $scale
     */
    private function scaleLookup(array $scale): JsonResponse
    {
        // A scale zero-pads the PLU field to its fixed width, so match both the
        // raw field and its leading-zeros-stripped form ("000021" ⇄ "21").
        $stripped = ltrim($scale['item_code'], '0');
        $codes = array_values(array_unique([$scale['item_code'], $stripped === '' ? '0' : $stripped]));

        /** @var Product|null $product */
        $product = Product::query()
            ->with(['variants', 'images', 'modifierGroups.options', 'units', 'comboItems.component:id,name', 'recipeItems.ingredient:id,name'])
            ->where('is_active', true)
            ->whereIn('plu_code', $codes)
            ->first();

        if ($product === null) {
            throw DomainException::unprocessable(
                "No item is mapped to scale code {$scale['item_code']}.",
                'POS_SCALE_ITEM_NOT_FOUND',
            );
        }

        if ($scale['mode'] === 'weight') {
            $quantity = (float) $scale['weight'];
        } else {
            // Price mode: derive weight = printed price ÷ per-unit price.
            $unit = $product->sellingPrice();
            $quantity = $unit > 0 ? round(((float) $scale['price']) / $unit, 3) : 0.0;
        }

        return ApiResponse::ok([
            'product' => $product,
            'variant_id' => null,
            'requires_prescription' => (bool) $product->requires_prescription,
            'near_expiry' => $this->nearExpiry($product),
            // The pre-filled quantity (weight) for this scanned label.
            'scale' => [
                'mode' => $scale['mode'],
                'quantity' => $quantity,
                'weight' => $scale['weight'],
                'embedded_price' => $scale['price'],
            ],
        ]);
    }

    /**
     * The soonest-expiring non-expired batch within 90 days, or null.
     *
     * @return array{batch_number: string, expiry_date: string, days: int}|null
     */
    private function nearExpiry(Product $product): ?array
    {
        $batch = $product->batches()
            ->where('quantity', '>', 0)
            ->whereNotNull('expiry_date')
            ->whereDate('expiry_date', '>=', today())
            ->whereDate('expiry_date', '<=', today()->addDays(90))
            ->orderBy('expiry_date')
            ->first();

        if ($batch === null) {
            return null;
        }

        return [
            'batch_number' => $batch->batch_number,
            'expiry_date' => $batch->expiry_date->toDateString(),
            'days' => (int) today()->diffInDays($batch->expiry_date),
        ];
    }

    // ── Cash sessions (shifts) ──────────────────────────────────────

    public function currentSession(Request $request): JsonResponse
    {
        $session = CashSession::query()
            ->with('register:id,name,code')
            ->where('user_id', $request->user()->id)
            ->where('status', 'open')
            ->first();

        if ($session !== null) {
            // My own drawer, with whoever is standing in for me right now.
            $active = $session->activeCover();

            return ApiResponse::ok([
                ...$session->toArray(),
                'covered_by' => $active === null ? null : [
                    'user_id' => $active->user_id,
                    'user_name' => $active->user?->name,
                    'started_at' => $active->started_at?->toIso8601String(),
                ],
            ]);
        }

        // No drawer of my own — but I may be holding someone else's lane.
        $cover = $this->activeCoverFor($request->user());

        return ApiResponse::ok($cover === null ? null : $this->coverView($cover));
    }

    /**
     * Take the lane while the cashier is away.
     *
     * The drawer does not change hands: the cashier who opened the shift still
     * counts it and still carries the variance. What changes is that the sales
     * rung in the next ten minutes are stamped with the person who actually
     * rang them, instead of with whoever happened to be logged in.
     */
    public function startCover(Request $request, ReliefCoverAction $action): JsonResponse
    {
        $data = $request->validate([
            'session_id' => ['nullable', 'uuid'],
            'reason' => ['nullable', 'string', 'max:191'],
        ]);

        $session = isset($data['session_id'])
            ? CashSession::query()->findOrFail($data['session_id'])
            : $this->terminal->get()?->openSession();

        if ($session === null) {
            throw DomainException::conflict(
                'There is no open shift on this register to cover. Open your own shift instead.',
                'SHIFT_NOT_OPEN',
            );
        }

        $cover = $action->start($request->user(), $session, $data['reason'] ?? null);

        return ApiResponse::ok(
            $this->coverView($cover),
            'You are covering '.($session->user?->name ?? 'this till'),
        );
    }

    /**
     * Hand the till back.
     *
     * Callable by the reliever (finished), the cashier (I'm back) or a manager.
     * The cashier returning usually never touches this — unlocking the till
     * with their own PIN ends the cover for them.
     */
    public function endCover(Request $request, ReliefCoverAction $action): JsonResponse
    {
        $user = $request->user();

        $cover = $this->activeCoverFor($user);

        if ($cover === null) {
            // The cashier ending someone else's cover on their own drawer.
            $mine = CashSession::query()
                ->where('user_id', $user->id)
                ->where('status', 'open')
                ->first();

            $cover = $mine?->activeCover();
        }

        if ($cover === null && $request->filled('session_id')) {
            abort_unless($user->hasAnyPermission(Permissions::SUPERVISES_TILLS), 403);
            $cover = CashSession::query()->findOrFail($request->input('session_id'))->activeCover();
        }

        if ($cover === null) {
            throw DomainException::conflict('Nobody is covering a till.', 'NOT_COVERING');
        }

        $ended = $action->end($cover, $user);

        return ApiResponse::ok($this->coverView($ended->fresh()), 'Till handed back');
    }

    /** The cover this user is currently holding on somebody else's drawer. */
    private function activeCoverFor(User $user): ?CashSessionCover
    {
        return CashSessionCover::query()
            ->with(['user:id,name', 'session.user:id,name', 'session.register:id,name,code'])
            ->whereNull('ended_at')
            ->where('user_id', $user->id)
            ->whereHas('session', fn ($q) => $q->where('status', 'open'))
            ->latest('started_at')
            ->first();
    }

    /**
     * What a reliever is allowed to see of a drawer that isn't theirs.
     *
     * The shift id (they have to name it on every sale), the lane, and whose
     * drawer it is. Not the opening float, not the expected cash — those are
     * the numbers the cashier will be measured against, and a cover grants the
     * right to sell, not the right to reconcile.
     *
     * @return array<string, mixed>
     */
    private function coverView(CashSessionCover $cover): array
    {
        $session = $cover->session;

        return [
            'id' => $cover->id,
            'covering' => true,
            'session_id' => $cover->cash_session_id,
            'cashier_name' => $session?->user?->name,
            'register' => $session?->register?->only(['id', 'name', 'code']),
            // Withheld figures are one thing; withholding that the whole drawer
            // is practice is another. A reliever who does not know would ring
            // real customers onto a training shift and take money for sales
            // that were never recorded.
            'is_training' => (bool) $session?->is_training,
            'started_at' => $cover->started_at?->toIso8601String(),
            'ended_at' => $cover->ended_at?->toIso8601String(),
            'reason' => $cover->reason,
            // What I have rung while standing here — my own figure, not the
            // drawer's.
            'mine' => $cover->figures(),
        ];
    }

    public function openSession(Request $request, OpenCashSessionAction $action): JsonResponse
    {
        $data = $request->validate([
            'opening_float' => ['required', 'numeric', 'min:0', 'max:99999999'],
            // The lane may be named explicitly (the picker) or come from the
            // terminal's own X-Register-Id header.
            'register_id' => ['nullable', 'uuid'],
            // The float counted by note and coin. When given it DERIVES the
            // opening float rather than sitting beside it.
            'denominations' => ['sometimes', 'array'],
            'denominations.*' => ['integer', 'min:0', 'max:100000'],
            // Practice. Everything rung on this shift is fenced off from stock,
            // the day's takings and every report — see the training_mode
            // migration. Chosen at open and fixed for the life of the shift.
            'is_training' => ['sometimes', 'boolean'],
        ]);

        $register = $this->resolveRegister($data['register_id'] ?? null);
        $training = (bool) ($data['is_training'] ?? false);
        $session = $action->execute(
            $request->user(),
            (float) $data['opening_float'],
            $register,
            $data['denominations'] ?? null,
            $training,
        );

        // A resumed shift is not a new one — say so, so the POS doesn't report
        // "Shift opened" over a drawer that has been running since morning.
        return $session->wasRecentlyCreated
            ? ApiResponse::created($session, $training ? 'Training shift opened' : 'Shift opened')
            : ApiResponse::ok($session, 'Resumed your open shift');
    }

    /** Terminal handover: carry my open shift (and its drawer) to another lane. */
    public function moveSession(Request $request, MoveCashSessionAction $action): JsonResponse
    {
        $data = $request->validate(['register_id' => ['required', 'uuid']]);

        $register = $this->resolveRegister($data['register_id']);
        if ($register === null) {
            throw DomainException::unprocessable('That register was not found.', 'REGISTER_NOT_FOUND');
        }

        return ApiResponse::ok($action->execute($request->user(), $register), 'Shift moved to '.$register->name);
    }

    public function closeSession(Request $request, CloseCashSessionAction $action): JsonResponse
    {
        $data = $request->validate($this->closeRules());

        /** @var CashSession|null $session */
        $session = CashSession::query()
            ->where('user_id', $request->user()->id)
            ->where('status', 'open')
            ->first();

        if ($session === null) {
            // A reliever gets told what they are actually holding, rather than
            // "no open shift" — which reads as a bug when they have been
            // selling on this lane for ten minutes.
            $cover = $this->activeCoverFor($request->user());

            if ($cover !== null) {
                throw DomainException::conflict(
                    'You are covering '.($cover->session?->user?->name ?? 'another cashier')
                        .'\'s drawer. They count it — hand the till back instead.',
                    'COVERING_ANOTHER_DRAWER',
                );
            }

            throw DomainException::conflict('You have no open shift to close.', 'SHIFT_NOT_OPEN');
        }

        // Somebody was still standing here when the cashier counted out. End it
        // now so the cover's figures freeze against the same drawer they were
        // rung into, instead of dangling past the close.
        app(ReliefCoverAction::class)->endFor($session, $request->user());

        $closed = $action->execute(
            $session,
            (float) $data['counted_cash'],
            $data['notes'] ?? null,
            $request->user()->id,
            [
                'denominations' => $data['denominations'] ?? null,
                'declared_tenders' => $data['declared_tenders'] ?? null,
                'blind' => (bool) $this->context->get()?->setting('pos_blind_close', false),
            ],
        );

        return ApiResponse::ok($this->maskBlind($closed, $request), 'Shift closed');
    }

    /**
     * Manager close of a lane's shift — the cashier who left without counting
     * out. Without this the lane stays locked (REGISTER_BUSY) until that one
     * person comes back, which in a mart means a checkout stands idle.
     * Permission-gated to settings.manage on the route.
     */
    public function forceCloseSession(Request $request, string $registerId, CloseCashSessionAction $action): JsonResponse
    {
        $data = $request->validate($this->closeRules());

        $register = Register::query()->findOrFail($registerId);
        $session = $register->openSession();

        if ($session === null) {
            throw DomainException::conflict('That register has no open shift.', 'SHIFT_NOT_OPEN');
        }

        $closed = $action->execute(
            $session,
            (float) $data['counted_cash'],
            $data['notes'] ?? null,
            $request->user()->id,
            [
                'denominations' => $data['denominations'] ?? null,
                'declared_tenders' => $data['declared_tenders'] ?? null,
                // A manager closing someone else's lane already knows the
                // expected figure — there is nothing to blind them to.
                'blind' => false,
            ],
        );

        return ApiResponse::ok($closed->load(['user:id,name', 'register:id,name']), 'Shift closed');
    }

    // ── Cash movements + the X-read ─────────────────────────────────

    /**
     * The live X-read for the caller's own open shift: what the drawer should
     * hold RIGHT NOW, and everything that got it there.
     *
     * A shift used to be write-only — the cashier could not see expected cash
     * at any point before closing, and the close figures were computed and then
     * thrown away. So a variance arrived as a surprise at 9pm with no way to
     * trace it. Same arithmetic as the close (DrawerMath), so the number a
     * cashier is shown mid-shift is the number they're held to.
     */
    public function sessionReport(Request $request): JsonResponse
    {
        /** @var CashSession|null $session */
        $session = CashSession::query()
            ->with(['register:id,name,code', 'user:id,name'])
            ->where('user_id', $request->user()->id)
            ->where('status', 'open')
            ->first();

        if ($session === null) {
            throw DomainException::conflict('You have no open shift.', 'SHIFT_NOT_OPEN');
        }

        $drawer = DrawerMath::for($session);
        $blind = (bool) $this->context->get()?->setting('pos_blind_close', false);

        // Under blind close the live read still shows the cashier everything
        // they DID — sales, tenders, every movement — and withholds only the
        // one number they are about to be measured against. Take that away
        // too and the X-read stops being useful for its real job: tracing a
        // variance back to the transaction that caused it.
        if ($blind && ! $request->user()->hasAnyPermission(Permissions::SUPERVISES_TILLS)) {
            unset($drawer['expected_cash'], $drawer['cash_sales']);
        }

        return ApiResponse::ok([
            'session' => $session,
            'drawer' => $drawer,
            'blind_close' => $blind,
            'denomination_count' => (bool) $this->context->get()?->setting('pos_denomination_count', true),
            'declare_tenders' => (bool) $this->context->get()?->setting('pos_declare_tenders', false),
            'denominations' => DenominationCount::PKR,
            // Who else rang on this drawer while the cashier was away. Without
            // it a variance is one undifferentiated number covering a stretch
            // the cashier wasn't even standing there for.
            'covers' => $this->coverBreakdown($session),
            'movements' => CashMovement::query()
                ->with('user:id,name')
                ->where('cash_session_id', $session->id)
                ->latest()
                ->get(),
        ]);
    }

    /**
     * Every stretch somebody else held this lane, with what they took.
     *
     * Frozen figures once a cover has ended, live while one is still running —
     * the same rule the day view follows for open shifts, and the same reason:
     * a running total that gets frozen halfway is worse than none.
     *
     * @return array<int, array<string, mixed>>
     */
    private function coverBreakdown(CashSession $session): array
    {
        return $session->covers()
            ->with(['user:id,name', 'endedBy:id,name'])
            ->get()
            ->map(fn (CashSessionCover $c) => [
                'id' => $c->id,
                'user_name' => $c->user?->name,
                'started_at' => $c->started_at?->toIso8601String(),
                'ended_at' => $c->ended_at?->toIso8601String(),
                'ended_by_name' => $c->endedBy?->name,
                'reason' => $c->reason,
                'open' => $c->isOpen(),
                ...$c->figures(),
            ])
            ->all();
    }

    /**
     * The Z-read for a closed shift: what was counted that night.
     *
     * Every figure comes off the frozen row rather than being recomputed, so a
     * report reprinted next year matches the slip that was signed — even if a
     * sale on it has since been voided or refunded. That is the whole point of
     * an end-of-shift artifact; a Z-read that changes retroactively is not
     * evidence of anything.
     */
    public function zReport(string $id): JsonResponse
    {
        /** @var CashSession $session */
        $session = CashSession::query()
            ->with(['user:id,name', 'register:id,name,code', 'branch:id,name', 'businessDay:id,trading_date,status'])
            ->findOrFail($id);

        if ($session->isOpen()) {
            throw DomainException::conflict(
                'This shift is still open — a Z-read is the record of a counted drawer.',
                'SHIFT_NOT_CLOSED',
            );
        }

        return ApiResponse::ok([
            'session' => $session,
            'movements' => CashMovement::query()
                ->with('user:id,name')
                ->where('cash_session_id', $session->id)
                ->orderBy('created_at')
                ->get(),
            // Part of the permanent record: a shift where someone else stood in
            // for twenty minutes is a different shift, and the Z-read is where
            // that has to be visible a year later.
            'covers' => $this->coverBreakdown($session),
            'closed_by' => $session->closed_by !== null
                ? User::query()->whereKey($session->closed_by)->value('name')
                : null,
        ]);
    }

    public function movements(Request $request): JsonResponse
    {
        $session = CashSession::query()
            ->where('user_id', $request->user()->id)
            ->where('status', 'open')
            ->first();

        if ($session === null) {
            return ApiResponse::ok([]);
        }

        return ApiResponse::ok(
            CashMovement::query()
                ->with('user:id,name')
                ->where('cash_session_id', $session->id)
                ->latest()
                ->get(),
        );
    }

    /**
     * Record a cash movement against my open drawer. Only the cashier-initiated
     * types are accepted here — the system types (khata received, supplier paid,
     * voided cash) are written by the flow that actually moved the money, so
     * they can't be forged from the till.
     */
    public function storeMovement(Request $request, RecordCashMovementAction $action): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', 'in:'.implode(',', CashMovement::MANUAL_TYPES)],
            'amount' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            'reason' => ['nullable', 'string', 'max:191'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);

        // A reliever may open the drawer to make change, and nothing else.
        // Taking money out of a box you will never count is the exact hole a
        // cover has to stay clear of — the cashier would come back to a
        // shortfall with a paid-out slip they never authorised.
        $cover = $this->activeCoverFor($request->user());

        if ($cover !== null) {
            if ($data['type'] !== 'no_sale') {
                throw DomainException::forbidden(
                    'You are covering '.($cover->session?->user?->name ?? 'another cashier')
                        .'\'s drawer. You can open it to make change, but only they can pay in or out of it.',
                    'COVER_CANNOT_MOVE_CASH',
                );
            }

            $movement = $action->execute($request->user(), $data, $cover->session);

            return ApiResponse::created($movement, 'Recorded');
        }

        $movement = $action->execute($request->user(), $data);

        return ApiResponse::created($movement, 'Recorded');
    }

    /**
     * The consolidated day view: every shift across every lane, with the totals
     * a manager reconciles the safe against. Defaults to today.
     */
    public function sessions(Request $request): JsonResponse
    {
        $data = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'register_id' => ['nullable', 'uuid'],
            'status' => ['nullable', 'in:open,closed'],
        ]);

        $from = isset($data['from']) ? Carbon::parse($data['from'])->startOfDay() : now()->startOfDay();
        $to = isset($data['to']) ? Carbon::parse($data['to'])->endOfDay() : now()->endOfDay();

        $sessions = CashSession::query()
            ->with(['user:id,name', 'register:id,name,code', 'branch:id,name'])
            ->whereBetween('opened_at', [$from, $to])
            ->when($this->branch->scopeId() !== null, fn ($q) => $q->where('branch_id', $this->branch->scopeId()))
            ->when(isset($data['register_id']), fn ($q) => $q->where('register_id', $data['register_id']))
            ->when(isset($data['status']), fn ($q) => $q->where('status', $data['status']))
            ->orderByDesc('opened_at')
            ->get();

        // A training shift is LISTED but never SUMMED. It happened — somebody
        // stood at a till for two hours — and dropping it from the history
        // would make a real stretch of the day vanish. What must not happen is
        // its practice cash landing in the totals a manager reads as takings.
        $real = $sessions->where('is_training', false);

        return ApiResponse::ok([
            'sessions' => $sessions,
            'totals' => [
                'shifts' => $real->count(),
                'open' => $real->where('status', 'open')->count(),
                'opening_float' => round((float) $real->sum('opening_float'), 2),
                'cash_sales' => round((float) $real->sum('cash_sales'), 2),
                'expected_cash' => round((float) $real->sum('expected_cash'), 2),
                'counted_cash' => round((float) $real->sum('counted_cash'), 2),
                'variance' => round((float) $real->sum('variance'), 2),
                'sales_total' => round((float) $real->sum('sales_total'), 2),
                'sales_count' => (int) $real->sum('sales_count'),
            ],
            'from' => $from->toDateTimeString(),
            'to' => $to->toDateTimeString(),
        ]);
    }

    /** The Z-read as paper. Same frozen figures as zReport(), on a printer. */
    public function zReportPrint(Request $request, string $id): Response
    {
        $data = $request->validate([
            'paper' => ['sometimes', 'in:standard,thermal_80,thermal_58'],
        ]);

        /** @var CashSession $session */
        $session = CashSession::query()
            ->with(['user:id,name', 'register:id,name', 'branch:id,name'])
            ->findOrFail($id);

        if ($session->isOpen()) {
            throw DomainException::conflict(
                'This shift is still open — a Z-read is the record of a counted drawer.',
                'SHIFT_NOT_CLOSED',
            );
        }

        $tenant = $this->context->get();

        return response()->view('pos.z-report', [
            'session' => $session,
            'tenant' => $tenant,
            'settings' => $tenant->allSettings(),
            'paper' => $data['paper'] ?? null,
            'closedBy' => $session->closed_by !== null
                ? User::query()->whereKey($session->closed_by)->value('name')
                : null,
            'movements' => CashMovement::query()
                ->where('cash_session_id', $session->id)
                ->orderBy('created_at')
                ->get(),
            'covers' => $this->coverBreakdown($session),
        ]);
    }

    /**
     * Validation shared by the cashier's own close and a manager's force-close.
     *
     * `counted_cash` stays required even when a denomination breakdown is sent:
     * a client that can only type a total must still work, and where both
     * arrive the breakdown wins (see CloseCashSessionAction).
     *
     * @return array<string, mixed>
     */
    private function closeRules(): array
    {
        return [
            'counted_cash' => ['required', 'numeric', 'min:0', 'max:99999999'],
            'notes' => ['nullable', 'string', 'max:500'],
            'denominations' => ['sometimes', 'array'],
            'denominations.*' => ['integer', 'min:0', 'max:100000'],
            // What the cashier says each non-cash tender took.
            'declared_tenders' => ['sometimes', 'array'],
            'declared_tenders.*' => ['numeric', 'min:0', 'max:99999999'],
        ];
    }

    /**
     * Hide the answer from the person being marked.
     *
     * Blind close is worth nothing if the expected figure comes back in the
     * close response — the cashier reads it, and next time they know what to
     * count to. A manager sees everything, because reconciling is their job and
     * they are not the one being checked.
     */
    private function maskBlind(CashSession $session, Request $request): CashSession
    {
        $blind = (bool) $this->context->get()?->setting('pos_blind_close', false);

        if (! $blind || $request->user()->hasAnyPermission(Permissions::SUPERVISES_TILLS)) {
            return $session;
        }

        return tap(clone $session, function (CashSession $masked): void {
            $masked->setAttribute('expected_cash', null);
            $masked->setAttribute('variance', null);
            $masked->setAttribute('cash_sales', null);
            $masked->setAttribute('tender_variances', null);
        });
    }

    /**
     * A lane the caller may actually use: this tenant's, active, and at the
     * branch being operated. Falls back to the terminal's own resolved lane.
     */
    private function resolveRegister(?string $id): ?Register
    {
        if ($id === null) {
            return $this->terminal->get();
        }

        $register = Register::query()->where('is_active', true)->whereKey($id)->first();

        $branchId = $this->branch->id();
        if ($register !== null && $register->branch_id !== null && $branchId !== null && $register->branch_id !== $branchId) {
            return null;
        }

        return $register;
    }

    // ── Held (parked) sales ─────────────────────────────────────────

    /**
     * Parked tickets belong to the SITE, not to the person who parked them.
     * A customer who runs back for a forgotten item returns to whichever lane
     * is short — so lane 3 must be able to see and resume lane 1's ticket. Each
     * row carries who parked it and where, so the list stays readable.
     */
    /**
     * The items this counter reaches for, without anyone maintaining a list.
     *
     * A scanner covers everything with a barcode. What it cannot do is the
     * loose half of a shop — vegetables, rice by the kilo, a cup of chai, the
     * samosas by the till — and those are exactly the fastest-moving lines in a
     * mart or a dhaba. Finding them meant typing a name into search, per item,
     * all day.
     *
     * DERIVED, never curated. A favourites list a merchant has to maintain is a
     * list that is wrong within a month: the till already knows what it sells.
     * Items with NO BARCODE come first — they are the ones that cannot be
     * scanned, so they are the ones a quick key actually saves — and the rest
     * of the slots go to what has sold most since. Branch-scoped, because what
     * moves at one shop is not what moves at another.
     *
     * A shop's first day returns an empty list and the strip simply isn't
     * drawn. Nothing to configure, nothing to explain.
     */
    public function quickKeys(Request $request): JsonResponse
    {
        $days = min(90, max(7, (int) $request->query('days', 30)));
        $limit = min(24, max(4, (int) $request->query('limit', 12)));
        $branchId = $this->branch->scopeId();
        $since = now()->subDays($days);

        $sold = SaleItem::query()
            ->whereHas('sale', fn ($q) => $q
                ->whereIn('status', [SaleStatus::Completed, SaleStatus::PartiallyRefunded])
                ->where('sold_at', '>=', $since)
                ->when($branchId !== null, fn ($s) => $s->where('branch_id', $branchId)))
            ->whereNotNull('product_id')
            ->selectRaw('product_id, SUM(quantity) as units')
            ->groupBy('product_id')
            ->orderByDesc('units')
            // Read wider than the slots on offer: the ranking is trimmed only
            // after inactive and deleted items have been dropped, or a
            // discontinued best-seller silently eats a slot.
            ->limit($limit * 3)
            ->pluck('units', 'product_id');

        if ($sold->isEmpty()) {
            return ApiResponse::ok([]);
        }

        $products = Product::query()
            ->with(['variants', 'images', 'units'])
            ->whereIn('id', $sold->keys())
            ->where('is_active', true)
            ->get()
            // Un-scannable first, then by what actually moved. A barcode-less
            // item is the whole reason this list exists.
            ->sortBy([
                fn (Product $a, Product $b) => (int) filled($a->barcode) <=> (int) filled($b->barcode),
                fn (Product $a, Product $b) => (float) $sold[$b->id] <=> (float) $sold[$a->id],
            ])
            ->take($limit)
            ->values();

        return ApiResponse::ok($products);
    }

    public function heldIndex(Request $request): JsonResponse
    {
        $branchId = $this->branch->scopeId();

        $held = HeldSale::query()
            ->with(['user:id,name', 'register:id,name,code'])
            ->when($branchId !== null, fn ($q) => $q->where(fn ($w) => $w->where('branch_id', $branchId)->orWhereNull('branch_id')))
            ->latest()
            ->get();

        return ApiResponse::ok($held);
    }

    public function heldStore(Request $request): JsonResponse
    {
        $data = $request->validate([
            'label' => ['nullable', 'string', 'max:120'],
            'cart' => ['required', 'array'],
            'total_estimate' => ['nullable', 'numeric', 'min:0'],
        ]);

        $held = HeldSale::query()->create([
            'tenant_id' => $request->user()->tenant_id,
            'branch_id' => $this->branch->id(),
            'register_id' => $this->terminal->id(),
            'user_id' => $request->user()->id,
            'label' => $data['label'] ?? null,
            'cart' => $data['cart'],
            'total_estimate' => $data['total_estimate'] ?? 0,
        ]);

        return ApiResponse::created($held->load(['user:id,name', 'register:id,name,code']), 'Sale held');
    }

    /**
     * CLAIM a parked ticket: hand back its cart and remove it in one atomic
     * step, so exactly one lane can resume it.
     *
     * Resuming used to be "load the cart, then fire a delete". Harmless when a
     * ticket was only visible to the cashier who parked it; now that a ticket
     * belongs to the site (any lane can finish it), two cashiers opening the
     * held list at the same moment could both load the same basket and both
     * ring it — two sales, two stock decrements, one customer. The row lock
     * makes the second caller lose cleanly instead.
     */
    public function heldClaim(Request $request, string $id): JsonResponse
    {
        return DB::transaction(function () use ($id): JsonResponse {
            /** @var HeldSale|null $held */
            $held = HeldSale::query()->whereKey($id)->lockForUpdate()->first();

            if ($held === null) {
                throw DomainException::conflict(
                    'That ticket was already resumed at another register.',
                    'HELD_ALREADY_CLAIMED',
                );
            }

            $this->assertSameBranch($held);

            $snapshot = $held->load(['user:id,name', 'register:id,name,code'])->toArray();
            $held->delete();

            return ApiResponse::ok($snapshot, 'Ticket resumed');
        });
    }

    /**
     * Any cashier at the same site may clear or resume a parked ticket — the
     * tenant scope plus the branch check below is the boundary that matters.
     */
    public function heldDestroy(Request $request, string $id): JsonResponse
    {
        /** @var HeldSale $held */
        $held = HeldSale::query()->findOrFail($id);
        $this->assertSameBranch($held);
        $held->delete();

        return ApiResponse::noContent('Held sale removed');
    }

    /** A ticket parked at another site is not this counter's business. */
    private function assertSameBranch(HeldSale $held): void
    {
        $branchId = $this->branch->scopeId();

        if ($branchId !== null && $held->branch_id !== null && $held->branch_id !== $branchId) {
            throw DomainException::forbidden('That held sale belongs to another branch.', 'HELD_OTHER_BRANCH');
        }
    }
}
