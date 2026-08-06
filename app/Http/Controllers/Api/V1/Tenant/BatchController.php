<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Services\InventoryService;
use App\Support\ApiResponse;
use App\Support\DotCode;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Batch/lot tracking (pharmacy, perishables). Adding a batch is a stock IN;
 * removing one writes the remaining quantity OUT — both through
 * InventoryService, so stock_quantity and stock_movements stay true.
 */
class BatchController extends Controller
{
    public function index(string $productId): JsonResponse
    {
        $product = Product::query()->findOrFail($productId);

        $warn = (int) ($this->ageSettings()['warn'] ?? 5);
        $old = (int) ($this->ageSettings()['old'] ?? 6);

        return ApiResponse::ok(
            $product->batches()->get()->map(fn (ProductBatch $b) => $b->toArray() + [
                // Computed, not stored: the age changes every day on its own.
                'age' => $b->humanAge(),
                'age_status' => $b->ageStatus($warn, $old),
            ]),
        );
    }

    /** How old this shop considers "ageing" and "old" — both configurable. */
    private function ageSettings(): array
    {
        $tenant = app(TenantContext::class)->get();

        return [
            'warn' => $tenant?->setting('stock_age_warn_years', 5) ?? 5,
            'old' => $tenant?->setting('stock_age_old_years', 6) ?? 6,
        ];
    }

    public function store(Request $request, string $productId, InventoryService $inventory): JsonResponse
    {
        $product = Product::query()->findOrFail($productId);

        $data = $request->validate([
            'batch_number' => ['required', 'string', 'max:64'],
            // A batch may belong to a specific variant (variant medicines get
            // their own expiry); must be a variant OF this product.
            'variant_id' => [
                'nullable', 'uuid',
                Rule::exists('product_variants', 'id')->where('product_id', $product->id),
            ],
            // Medicines MUST carry an expiry (FEFO + the expired-stock fence rely
            // on it); other perishables may leave it blank.
            'expiry_date' => [$product->requiresExpiry() ? 'required' : 'nullable', 'date'],
            // The four digits off a tyre's sidewall: 2224 = week 22 of 2024.
            // Kept as written, because that is what a customer will point at.
            'dot_code' => ['nullable', 'string', 'regex:'.DotCode::PATTERN],
            // Derived from the DOT code when one was given, or entered directly
            // for anything else that ages on a shelf rather than expiring.
            'manufactured_on' => ['nullable', 'date', 'before_or_equal:today'],
            'quantity' => ['required', 'numeric', 'min:0.001'],
            'cost' => ['nullable', 'numeric', 'min:0'],
        ], [
            'expiry_date.required' => 'An expiry date is required for medicine batches.',
            'dot_code.regex' => 'A DOT code is four digits — week then year, e.g. 2224 for week 22 of 2024.',
            'manufactured_on.before_or_equal' => 'A manufacturing date cannot be in the future.',
        ]);

        // A code that resolves to a real week wins over a typed date: it is the
        // thing physically printed on the tyre, and the two disagreeing means
        // somebody mistyped the date, not the sidewall.
        $manufacturedOn = DotCode::toDate($data['dot_code'] ?? null)?->toDateString()
            ?? ($data['manufactured_on'] ?? null);

        $mainBranchId = Branch::withoutTenancy()
            ->where('tenant_id', $product->tenant_id)->where('is_default', true)->value('id');

        $batch = DB::transaction(function () use ($product, $data, $inventory, $mainBranchId, $manufacturedOn): ProductBatch {
            $batch = ProductBatch::query()->create([
                'branch_id' => $mainBranchId,
                'product_id' => $product->id,
                'variant_id' => $data['variant_id'] ?? null,
                'batch_number' => $data['batch_number'],
                'expiry_date' => $data['expiry_date'] ?? null,
                'dot_code' => $data['dot_code'] ?? null,
                'manufactured_on' => $manufacturedOn,
                'quantity' => $data['quantity'],
                'cost' => $data['cost'] ?? null,
            ]);

            if ($product->track_inventory) {
                $inventory->adjust([
                    'product_id' => $product->id,
                    'variant_id' => $data['variant_id'] ?? null,
                    'branch_id' => $mainBranchId,
                    'type' => 'in',
                    'quantity' => (float) $data['quantity'],
                    'reason' => "Batch {$data['batch_number']} received",
                    'reference_type' => 'batch',
                    'reference_id' => $batch->id,
                    'idempotency_key' => "batch-in-{$batch->id}",
                ]);
            }

            return $batch;
        });

        return ApiResponse::created($batch, 'Batch added');
    }

    /**
     * Edit lot METADATA (number, expiry, sidewall date) — e.g. filling in the
     * expiry on a lot auto-created by a PO receipt, or the DOT code somebody
     * only read off the tyre after it was booked in. Quantity is never editable
     * here: it moves exclusively through the audited stock flows.
     */
    public function update(Request $request, string $id): JsonResponse
    {
        /** @var ProductBatch $batch */
        $batch = ProductBatch::query()->with('product:id,item_type')->findOrFail($id);

        // A medicine lot may have its expiry corrected but never cleared.
        $expiryNullable = ! ($batch->product?->requiresExpiry() ?? false);

        $data = $request->validate([
            'batch_number' => ['sometimes', 'string', 'max:64'],
            'expiry_date' => ['sometimes', $expiryNullable ? 'nullable' : 'required', 'date'],
            'dot_code' => ['sometimes', 'nullable', 'string', 'regex:'.DotCode::PATTERN],
            'manufactured_on' => ['sometimes', 'nullable', 'date', 'before_or_equal:today'],
        ], [
            'expiry_date.required' => 'A medicine batch must keep an expiry date.',
            'dot_code.regex' => 'A DOT code is four digits — week then year, e.g. 2224 for week 22 of 2024.',
        ]);

        // Setting the code sets the date with it, so the two can never drift
        // apart into a lot whose sidewall says one thing and whose age says
        // another.
        if (array_key_exists('dot_code', $data)) {
            $data['manufactured_on'] = DotCode::toDate($data['dot_code'])?->toDateString()
                ?? ($data['manufactured_on'] ?? null);
        }

        $batch->update($data);

        return ApiResponse::ok($batch, 'Batch updated');
    }

    public function destroy(string $id, InventoryService $inventory): JsonResponse
    {
        /** @var ProductBatch $batch */
        $batch = ProductBatch::query()->with('product')->findOrFail($id);

        DB::transaction(function () use ($batch, $inventory): void {
            $remaining = (float) $batch->quantity;
            // Zero the batch FIRST so the FEFO hook can't double-deplete it.
            $batch->update(['quantity' => 0]);

            if ($remaining > 0 && $batch->product->track_inventory) {
                $inventory->adjust([
                    'product_id' => $batch->product_id,
                    'variant_id' => $batch->variant_id,
                    'branch_id' => $batch->branch_id,
                    'type' => 'out',
                    'quantity' => $remaining,
                    'reason' => "Batch {$batch->batch_number} removed/expired",
                    'reference_type' => 'batch',
                    'reference_id' => $batch->id,
                    'idempotency_key' => "batch-out-{$batch->id}",
                ]);
            }

            $batch->delete();
        });

        return ApiResponse::noContent('Batch removed');
    }

    /**
     * Batches expiring within N days (default 30) + already-expired stock.
     */
    public function expiring(Request $request): JsonResponse
    {
        $days = min((int) $request->query('days', 30), 365);

        $batches = ProductBatch::query()
            ->expiringWithin($days)
            ->with('product:id,name,sku')
            ->orderBy('expiry_date')
            ->get()
            ->map(fn (ProductBatch $b) => [
                'id' => $b->id,
                'product' => $b->product?->only(['id', 'name', 'sku']),
                'batch_number' => $b->batch_number,
                'expiry_date' => $b->expiry_date?->toDateString(),
                'quantity' => (float) $b->quantity,
                'expired' => $b->expiry_date !== null && $b->expiry_date->isPast(),
            ]);

        return ApiResponse::ok($batches);
    }
}
