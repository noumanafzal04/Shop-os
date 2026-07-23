<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Pos\CloseCashSessionAction;
use App\Actions\Pos\OpenCashSessionAction;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Models\CashSession;
use App\Models\HeldSale;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PosController extends Controller
{
    /**
     * Scan/lookup by barcode or SKU. Matches a product's own code, or a
     * variant's SKU (returning the parent product with the variant preselected).
     */
    public function __construct(private readonly \App\Support\TenantContext $context) {}

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
            ->with(['variants', 'images', 'modifierGroups.options', 'units', 'comboItems.component:id,name'])
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
                $product = Product::query()->with(['variants', 'images', 'modifierGroups.options', 'units', 'comboItems.component:id,name'])->find($variant->product_id);
                $variantId = $variant->id;
            }
        }

        if ($product === null) {
            // A pack (strip/box) can carry its own barcode — scanning it should
            // preselect that pack on the line.
            $unit = \App\Models\ProductUnit::query()->where('barcode', $code)->first();
            if ($unit !== null) {
                $product = Product::query()->with(['variants', 'images', 'modifierGroups.options', 'units', 'comboItems.component:id,name'])
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
            ->with(['variants', 'images', 'modifierGroups.options', 'units', 'comboItems.component:id,name'])
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
            ->where('user_id', $request->user()->id)
            ->where('status', 'open')
            ->first();

        return ApiResponse::ok($session);
    }

    public function openSession(Request $request, OpenCashSessionAction $action): JsonResponse
    {
        $data = $request->validate([
            'opening_float' => ['required', 'numeric', 'min:0', 'max:99999999'],
        ]);

        $session = $action->execute($request->user(), (float) $data['opening_float']);

        return ApiResponse::created($session, 'Shift opened');
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

        $closed = $action->execute($session, (float) $data['counted_cash'], $data['notes'] ?? null);

        return ApiResponse::ok($closed, 'Shift closed');
    }

    // ── Held (parked) sales ─────────────────────────────────────────

    public function heldIndex(Request $request): JsonResponse
    {
        $held = HeldSale::query()
            ->where('user_id', $request->user()->id)
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
            'user_id' => $request->user()->id,
            'label' => $data['label'] ?? null,
            'cart' => $data['cart'],
            'total_estimate' => $data['total_estimate'] ?? 0,
        ]);

        return ApiResponse::created($held, 'Sale held');
    }

    public function heldDestroy(Request $request, string $id): JsonResponse
    {
        $held = HeldSale::query()
            ->where('user_id', $request->user()->id)
            ->findOrFail($id);
        $held->delete();

        return ApiResponse::noContent('Held sale removed');
    }
}
