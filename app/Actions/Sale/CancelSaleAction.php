<?php

namespace App\Actions\Sale;

use App\Enums\ItemType;
use App\Enums\SaleStatus;
use App\Exceptions\DomainException;
use App\Models\Sale;
use App\Services\InventoryService;
use Illuminate\Support\Facades\DB;

/**
 * Cancels a completed sale and restores stock — atomically.
 *
 * Edge cases:
 *  - double cancellation      → 409 SALE_ALREADY_CANCELLED
 *  - restore applied twice    → per-item idempotency keys make the stock
 *                               restore replay-safe even across retries
 *  - product deleted since    → restore skipped for missing products
 *                               (nothing to put stock back onto)
 */
class CancelSaleAction
{
    public function __construct(private readonly InventoryService $inventory)
    {
    }

    public function execute(Sale $sale, ?string $reason = null): Sale
    {
        if ($sale->isCancelled()) {
            throw DomainException::conflict('This sale is already cancelled.', 'SALE_ALREADY_CANCELLED');
        }

        return DB::transaction(function () use ($sale, $reason): Sale {
            foreach ($sale->items as $item) {
                if ($item->product_id === null) {
                    continue;
                }

                /** @var \App\Models\Product|null $product */
                $product = $item->product; // withTrashed — a deleted deal still knows its components

                // A deal restores each component's stock (component qty × sold
                // deal qty); a normal product restores its OWN stock in BASE
                // units (sold count × unit_factor — a pack drew factor× out).
                // Mirrors CreateSaleAction / OrderService::releaseStock so a
                // combo or pack sale reverses exactly what it decremented.
                if ($product !== null && $product->isCombo()) {
                    foreach ($product->comboItems()->with('component')->get() as $ci) {
                        $component = $ci->component;
                        if ($component !== null && $component->type === ItemType::Product && $component->track_inventory) {
                            $this->inventory->adjust([
                                'product_id' => $component->id,
                                'type' => 'in',
                                'quantity' => round((float) $ci->quantity * (float) $item->quantity, 3),
                                'reason' => "Cancelled {$sale->invoice_number} (deal: {$product->name})",
                                'reference_type' => 'sale_cancellation',
                                'reference_id' => $sale->id,
                                'idempotency_key' => "cancel-{$item->id}-c{$component->id}",
                            ]);
                        }
                    }
                } elseif (
                    $item->item_type === ItemType::Product->value
                    && $product !== null
                    && ! $product->trashed()
                    && $product->track_inventory
                ) {
                    $this->inventory->adjust([
                        'product_id' => $item->product_id,
                        'variant_id' => $item->variant_id,
                        'type' => 'in',
                        // Pack sold: restore factor× the sold count (base units).
                        'quantity' => round((float) $item->quantity * (float) ($item->unit_factor ?? 1), 3),
                        'reason' => "Cancelled {$sale->invoice_number}",
                        'reference_type' => 'sale_cancellation',
                        'reference_id' => $sale->id,
                        'idempotency_key' => "cancel-{$item->id}",
                    ]);
                }
            }

            $sale->forceFill([
                'status' => SaleStatus::Cancelled,
                'cancelled_at' => now(),
                'cancelled_by' => auth()->id(),
                'cancel_reason' => $reason,
            ])->save();

            return $sale->load('items');
        });
    }
}
