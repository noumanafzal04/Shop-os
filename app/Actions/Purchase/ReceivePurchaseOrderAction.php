<?php

namespace App\Actions\Purchase;

use App\Enums\PurchaseStatus;
use App\Exceptions\DomainException;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\ProductSerial;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderItem;
use App\Models\StockMovement;
use App\Services\InventoryService;
use App\Support\ItemTypes;
use Illuminate\Support\Facades\DB;

/**
 * Receives goods against a PO — moving stock IN through the single
 * InventoryService write-path (audited, idempotent). Supports partial
 * receipts; the PO closes to `received` only when every line is fulfilled.
 *
 * Batch-tracked products (medicine, or anything already managed in lots)
 * land as a ProductBatch too, so stock_quantity and batch totals stay in
 * step and FEFO/expiry reporting covers purchased stock. Any line may also
 * opt in explicitly by carrying a batch_number / expiry_date.
 *
 * Retry safety: pass an idempotency key (one per receipt attempt) — a line
 * whose movement already exists under that key is skipped wholesale, so a
 * network retry can never double-receive or double-create batches.
 *
 * Non-inventory items (e.g. food) are marked received without a stock move.
 */
class ReceivePurchaseOrderAction
{
    public function __construct(private readonly InventoryService $inventory) {}

    /**
     * @param array<string, array{quantity: float, batch_number: ?string, expiry_date: ?string}> $receiveMap
     *        poItemId => receipt line. Empty → receive all outstanding.
     */
    public function execute(PurchaseOrder $po, array $receiveMap = [], ?string $idempotencyKey = null): PurchaseOrder
    {
        // Replay: a retry under a key that already produced receipts for this
        // PO returns the current state untouched — even if the first attempt
        // closed the PO to `received` (which would otherwise fail canReceive).
        if ($idempotencyKey !== null && StockMovement::withoutTenancy()
            ->where('reference_type', 'purchase_order')
            ->where('reference_id', $po->id)
            ->where('idempotency_key', 'like', "po-{$po->id}-item-%-{$idempotencyKey}")
            ->exists()) {
            return $po->load('items', 'supplier');
        }

        if (! $po->status->canReceive()) {
            throw DomainException::conflict(
                'This purchase order cannot receive goods in its current state.',
                'PO_NOT_RECEIVABLE',
            );
        }

        return DB::transaction(function () use ($po, $receiveMap, $idempotencyKey): PurchaseOrder {
            $po->load('items');
            $receivedSomething = false;

            foreach ($po->items as $item) {
                $row = $receiveMap[$item->id] ?? null;

                // Exactly-once per receipt attempt: if this line already went
                // through under this key, a retry must not touch it again
                // (stock, quantity_received, or batches).
                $movementKey = $idempotencyKey !== null
                    ? "po-{$po->id}-item-{$item->id}-{$idempotencyKey}"
                    : null;
                if ($movementKey !== null && StockMovement::withoutTenancy()
                    ->where('idempotency_key', $movementKey)->exists()) {
                    $receivedSomething = true;

                    continue;
                }

                $outstanding = $item->outstanding();
                if ($outstanding <= 0) {
                    continue;
                }

                // Explicit map wins; otherwise receive all outstanding.
                $qty = $row !== null ? (float) $row['quantity'] : $outstanding;
                $qty = max(0, min($qty, $outstanding));
                if ($qty <= 0) {
                    continue;
                }

                $newReceived = round((float) $item->quantity_received + $qty, 3);

                // A line ordered in packs receives in packs but stocks BASE
                // units — 5 boxes (×100) → 500 tablets. Batch cost is per base
                // unit (pack cost ÷ factor) so valuation/FEFO stay per-unit.
                $factor = (float) ($item->unit_factor ?? 1) ?: 1.0;
                $baseQty = round($qty * $factor, 3);

                // Move stock in — only for items that still track inventory.
                $product = $item->product_id !== null
                    ? Product::query()->whereKey($item->product_id)->first()
                    : null;

                if ($product !== null && $product->track_inventory) {
                    // Medicines must be received into a DATED lot — FEFO and the
                    // expired-stock fence rely on it, so no expiry, no receipt.
                    if ($product->requiresExpiry() && ($row['expiry_date'] ?? null) === null) {
                        throw DomainException::unprocessable(
                            "An expiry date is required to receive \"{$product->name}\" (medicine).",
                            'EXPIRY_REQUIRED',
                        );
                    }

                    $this->inventory->adjust([
                        'product_id' => $item->product_id,
                        'variant_id' => $item->variant_id,
                        'type' => 'in',
                        'quantity' => $baseQty,
                        'reason' => "Received PO {$po->po_number}",
                        'reference_type' => 'purchase_order',
                        'reference_id' => $po->id,
                        'idempotency_key' => $movementKey ?? "po-{$po->id}-item-{$item->id}-recv-{$newReceived}",
                    ]);

                    // Land the receipt as a lot when the product is batch-
                    // tracked (or the line explicitly carries lot data). The lot
                    // is scoped to the received variant (NULL for product-level),
                    // so variant medicines keep their own expiry + FEFO.
                    $wantsBatch = $row !== null
                        && (($row['batch_number'] ?? null) !== null || ($row['expiry_date'] ?? null) !== null);
                    $isBatchTracked = $product->item_type === ItemTypes::MEDICINE
                        || $product->batches()->exists();

                    if ($wantsBatch || $isBatchTracked) {
                        ProductBatch::query()->create([
                            'tenant_id' => $product->tenant_id,
                            // Same branch the adjust() above credited (default
                            // Main) — lots and on-hand must not drift apart.
                            'branch_id' => \App\Models\Branch::withoutTenancy()
                                ->where('tenant_id', $product->tenant_id)->where('is_default', true)->value('id'),
                            'product_id' => $product->id,
                            'variant_id' => $item->variant_id,
                            'batch_number' => $row['batch_number'] ?? $po->po_number,
                            'expiry_date' => $row['expiry_date'] ?? null,
                            'quantity' => $baseQty,
                            'cost' => $item->unit_cost !== null ? round((float) $item->unit_cost / $factor, 2) : null,
                        ]);
                    }

                    // Serial-on-receive: register each captured IMEI/serial as an
                    // in_stock unit. Can't book more serials than units received;
                    // a serial already in this tenant's registry (in stock or out
                    // on a live sale) can't be received again.
                    $this->registerSerials($product, $item, $row['serials'] ?? [], $baseQty, $po);
                }

                $item->forceFill(['quantity_received' => $newReceived])->save();
                $receivedSomething = true;
            }

            if (! $receivedSomething) {
                throw DomainException::unprocessable('Nothing left to receive on this order.', 'PO_NOTHING_TO_RECEIVE');
            }

            // Recompute status from line fulfilment.
            $po->load('items');
            $fullyReceived = $po->items->every(fn ($i) => $i->quantity_received >= $i->quantity_ordered);

            $po->forceFill([
                'status' => $fullyReceived ? PurchaseStatus::Received : PurchaseStatus::PartiallyReceived,
                'received_at' => $fullyReceived ? now() : $po->received_at,
            ])->save();

            return $po->load('items', 'supplier');
        });
    }

    /**
     * Register the captured serials of a received line as in_stock units.
     * Guards: the product must be serialized, you can't book more serials than
     * base units received, and a serial already in this tenant's registry
     * (in stock or out on a sale) can't be received again.
     *
     * @param  array<int, string>  $serials
     */
    private function registerSerials(Product $product, PurchaseOrderItem $item, array $serials, float $baseQty, PurchaseOrder $po): void
    {
        if (empty($serials)) {
            return;
        }

        if (! $product->tracksSerial()) {
            throw DomainException::unprocessable(
                "\"{$product->name}\" is not a serialized item — remove the serials.",
                'SERIAL_NOT_TRACKED',
            );
        }

        if (count($serials) > $baseQty) {
            throw DomainException::unprocessable(
                "You entered more serials than units received for \"{$product->name}\".",
                'SERIAL_COUNT_EXCEEDS_QTY',
            );
        }

        $branchId = \App\Models\Branch::withoutTenancy()
            ->where('tenant_id', $product->tenant_id)->where('is_default', true)->value('id');

        foreach ($serials as $serial) {
            $exists = ProductSerial::withoutTenancy()
                ->where('tenant_id', $product->tenant_id)
                ->where('product_id', $product->id)
                ->where('serial', $serial)
                ->exists();
            if ($exists) {
                throw DomainException::unprocessable(
                    "Serial \"{$serial}\" is already registered for {$product->name}.",
                    'SERIAL_ALREADY_REGISTERED',
                );
            }

            ProductSerial::withoutTenancy()->create([
                'tenant_id' => $product->tenant_id,
                'product_id' => $product->id,
                'variant_id' => $item->variant_id,
                'branch_id' => $branchId,
                'serial' => $serial,
                'status' => 'in_stock',
                'source' => 'purchase_order',
                'source_id' => $po->id,
                'received_at' => now(),
            ]);
        }
    }
}
