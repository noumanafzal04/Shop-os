<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Services\InventoryService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

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

        return ApiResponse::ok($product->batches()->get());
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
                \Illuminate\Validation\Rule::exists('product_variants', 'id')->where('product_id', $product->id),
            ],
            'expiry_date' => ['nullable', 'date'],
            'quantity' => ['required', 'numeric', 'min:0.001'],
            'cost' => ['nullable', 'numeric', 'min:0'],
        ]);

        $mainBranchId = \App\Models\Branch::withoutTenancy()
            ->where('tenant_id', $product->tenant_id)->where('is_default', true)->value('id');

        $batch = DB::transaction(function () use ($product, $data, $inventory, $mainBranchId): ProductBatch {
            $batch = ProductBatch::query()->create([
                'branch_id' => $mainBranchId,
                'product_id' => $product->id,
                'variant_id' => $data['variant_id'] ?? null,
                'batch_number' => $data['batch_number'],
                'expiry_date' => $data['expiry_date'] ?? null,
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
     * Edit lot METADATA (number / expiry) — e.g. filling in the expiry on a
     * lot auto-created by a PO receipt. Quantity is never editable here: it
     * moves exclusively through the audited stock flows.
     */
    public function update(Request $request, string $id): JsonResponse
    {
        /** @var ProductBatch $batch */
        $batch = ProductBatch::query()->findOrFail($id);

        $data = $request->validate([
            'batch_number' => ['sometimes', 'string', 'max:64'],
            'expiry_date' => ['sometimes', 'nullable', 'date'],
        ]);

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
