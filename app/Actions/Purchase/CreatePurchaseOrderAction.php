<?php

namespace App\Actions\Purchase;

use App\Enums\PurchaseStatus;
use App\Models\Product;
use App\Models\ProductUnit;
use App\Models\ProductVariant;
use App\Models\PurchaseOrder;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Creates a purchase order with line items — atomically. Totals are computed
 * server-side (never trusted from the client). A PO starts as `draft` or
 * `ordered`; stock only moves on receipt (see ReceivePurchaseOrderAction).
 */
class CreatePurchaseOrderAction
{
    public function __construct(private readonly TenantContext $context) {}

    /**
     * @param array{
     *   supplier_id: string, order_date: string, expected_date?: ?string,
     *   discount?: float, tax?: float, notes?: ?string, status?: string,
     *   items: array<array{product_id:string, variant_id?:?string, quantity:int, unit_cost:float}>
     * } $data
     */
    public function execute(array $data): PurchaseOrder
    {
        $tenantId = $this->context->id();

        return DB::transaction(function () use ($data, $tenantId): PurchaseOrder {
            $subtotal = 0.0;
            $lines = [];

            foreach ($data['items'] as $item) {
                /** @var Product $product */
                $product = Product::query()->whereKey($item['product_id'])->firstOrFail();
                $variant = null;
                if (! empty($item['variant_id'])) {
                    /** @var ProductVariant $variant */
                    $variant = ProductVariant::query()
                        ->whereKey($item['variant_id'])
                        ->where('product_id', $product->id)
                        ->firstOrFail();
                }

                // Buy-in-packs: a line may be ordered in a defined pack (Box);
                // quantity + cost are then per pack, and receipt lands base
                // units (qty × factor). Packs don't combine with variants.
                $unit = null;
                if ($variant === null && ! empty($item['product_unit_id'])) {
                    $unit = ProductUnit::query()
                        ->whereKey($item['product_unit_id'])
                        ->where('product_id', $product->id)
                        ->first();
                }
                $factor = $unit !== null ? (float) $unit->factor : 1.0;

                $qty = (float) $item['quantity'];
                $unitCost = round((float) $item['unit_cost'], 2);
                $lineTotal = round($unitCost * $qty, 2);
                $subtotal = round($subtotal + $lineTotal, 2);

                $lines[] = [
                    'tenant_id' => $tenantId,
                    'product_id' => $product->id,
                    'variant_id' => $variant?->id,
                    'product_unit_id' => $unit?->id,
                    'product_name' => $product->name,
                    'variant_name' => $variant?->name,
                    'unit_name' => $unit?->name,
                    'quantity_ordered' => $qty,
                    'quantity_received' => 0,
                    'unit_factor' => $factor,
                    'unit_cost' => $unitCost,
                    'line_total' => $lineTotal,
                ];
            }

            $discount = round((float) ($data['discount'] ?? 0), 2);
            $tax = round((float) ($data['tax'] ?? 0), 2);
            $total = round($subtotal - $discount + $tax, 2);

            $seq = PurchaseOrder::query()->withTrashed()->count() + 1;

            /** @var PurchaseOrder $po */
            $po = PurchaseOrder::query()->create([
                'supplier_id' => $data['supplier_id'],
                'po_number' => 'PO-'.str_pad((string) $seq, 6, '0', STR_PAD_LEFT),
                'status' => ($data['status'] ?? 'draft') === 'ordered'
                    ? PurchaseStatus::Ordered
                    : PurchaseStatus::Draft,
                'order_date' => $data['order_date'],
                'expected_date' => $data['expected_date'] ?? null,
                'subtotal' => $subtotal,
                'discount' => $discount,
                'tax' => $tax,
                'total' => $total,
                'amount_paid' => 0,
                'payment_status' => 'unpaid',
                'notes' => $data['notes'] ?? null,
            ]);

            $po->items()->createMany($lines);

            return $po->load('items', 'supplier');
        });
    }
}
