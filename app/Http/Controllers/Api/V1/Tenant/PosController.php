<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Pos\CloseCashSessionAction;
use App\Actions\Pos\MoveCashSessionAction;
use App\Actions\Pos\OpenCashSessionAction;
use App\Actions\Pos\RecordCashMovementAction;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Models\CashMovement;
use App\Models\CashSession;
use App\Models\HeldSale;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Register;
use App\Support\ApiResponse;
use App\Support\DrawerMath;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PosController extends Controller
{
    /**
     * Scan/lookup by barcode or SKU. Matches a product's own code, or a
     * variant's SKU (returning the parent product with the variant preselected).
     */
    public function __construct(
        private readonly \App\Support\TenantContext $context,
        private readonly \App\Support\BranchContext $branch,
        private readonly \App\Support\RegisterContext $terminal,
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
        $scale = \App\Support\ScaleBarcode::parse($code, $this->context->get()?->allSettings() ?? []);
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
                ?? \App\Models\ProductBarcode::query()->where('barcode', $code)->whereNotNull('variant_id')->first()?->variant;
            if ($variant !== null) {
                $product = Product::query()->with(['variants', 'images', 'modifierGroups.options', 'units', 'comboItems.component:id,name', 'recipeItems.ingredient:id,name'])->find($variant->product_id);
                $variantId = $variant->id;
            }
        }

        if ($product === null) {
            // A pack (strip/box) can carry its own barcode — scanning it should
            // preselect that pack on the line.
            $unit = \App\Models\ProductUnit::query()->where('barcode', $code)->first();
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

        return ApiResponse::ok($session);
    }

    public function openSession(Request $request, OpenCashSessionAction $action): JsonResponse
    {
        $data = $request->validate([
            'opening_float' => ['required', 'numeric', 'min:0', 'max:99999999'],
            // The lane may be named explicitly (the picker) or come from the
            // terminal's own X-Register-Id header.
            'register_id' => ['nullable', 'uuid'],
        ]);

        $register = $this->resolveRegister($data['register_id'] ?? null);
        $session = $action->execute($request->user(), (float) $data['opening_float'], $register);

        // A resumed shift is not a new one — say so, so the POS doesn't report
        // "Shift opened" over a drawer that has been running since morning.
        return $session->wasRecentlyCreated
            ? ApiResponse::created($session, 'Shift opened')
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
        $data = $request->validate([
            'counted_cash' => ['required', 'numeric', 'min:0', 'max:99999999'],
            'notes' => ['nullable', 'string', 'max:500'],
        ]);

        /** @var CashSession|null $session */
        $session = CashSession::query()
            ->where('user_id', $request->user()->id)
            ->where('status', 'open')
            ->first();

        if ($session === null) {
            throw DomainException::conflict('You have no open shift to close.', 'SHIFT_NOT_OPEN');
        }

        $closed = $action->execute($session, (float) $data['counted_cash'], $data['notes'] ?? null, $request->user()->id);

        return ApiResponse::ok($closed, 'Shift closed');
    }

    /**
     * Manager close of a lane's shift — the cashier who left without counting
     * out. Without this the lane stays locked (REGISTER_BUSY) until that one
     * person comes back, which in a mart means a checkout stands idle.
     * Permission-gated to settings.manage on the route.
     */
    public function forceCloseSession(Request $request, string $registerId, CloseCashSessionAction $action): JsonResponse
    {
        $data = $request->validate([
            'counted_cash' => ['required', 'numeric', 'min:0', 'max:99999999'],
            'notes' => ['nullable', 'string', 'max:500'],
        ]);

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

        return ApiResponse::ok([
            'session' => $session,
            'drawer' => DrawerMath::for($session),
            'movements' => CashMovement::query()
                ->with('user:id,name')
                ->where('cash_session_id', $session->id)
                ->latest()
                ->get(),
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

        $from = isset($data['from']) ? \Illuminate\Support\Carbon::parse($data['from'])->startOfDay() : now()->startOfDay();
        $to = isset($data['to']) ? \Illuminate\Support\Carbon::parse($data['to'])->endOfDay() : now()->endOfDay();

        $sessions = CashSession::query()
            ->with(['user:id,name', 'register:id,name,code', 'branch:id,name'])
            ->whereBetween('opened_at', [$from, $to])
            ->when($this->branch->scopeId() !== null, fn ($q) => $q->where('branch_id', $this->branch->scopeId()))
            ->when(isset($data['register_id']), fn ($q) => $q->where('register_id', $data['register_id']))
            ->when(isset($data['status']), fn ($q) => $q->where('status', $data['status']))
            ->orderByDesc('opened_at')
            ->get();

        return ApiResponse::ok([
            'sessions' => $sessions,
            'totals' => [
                'shifts' => $sessions->count(),
                'open' => $sessions->where('status', 'open')->count(),
                'opening_float' => round((float) $sessions->sum('opening_float'), 2),
                'cash_sales' => round((float) $sessions->sum('cash_sales'), 2),
                'expected_cash' => round((float) $sessions->sum('expected_cash'), 2),
                'counted_cash' => round((float) $sessions->sum('counted_cash'), 2),
                'variance' => round((float) $sessions->sum('variance'), 2),
                'sales_total' => round((float) $sessions->sum('sales_total'), 2),
                'sales_count' => (int) $sessions->sum('sales_count'),
            ],
            'from' => $from->toDateTimeString(),
            'to' => $to->toDateTimeString(),
        ]);
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
        return DB::transaction(function () use ($request, $id): JsonResponse {
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
