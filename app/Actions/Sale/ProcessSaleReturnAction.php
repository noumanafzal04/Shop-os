<?php

namespace App\Actions\Sale;

use App\Enums\ItemType;
use App\Enums\SaleStatus;
use App\Exceptions\DomainException;
use App\Models\Customer;
use App\Models\Product;
use App\Models\Sale;
use App\Models\SaleReturn;
use App\Models\SaleReturnItem;
use App\Services\InventoryService;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Processes a full or partial return against a completed sale:
 *   validate quantities → restock (IN via InventoryService) → refund record
 *   → recompute sale status (partially_refunded / refunded).
 *
 * A line can never be returned for more than was sold (minus prior returns).
 */
class ProcessSaleReturnAction
{
    public function __construct(
        private readonly InventoryService $inventory,
        private readonly TenantContext $context,
    ) {}

    /**
     * @param array{
     *   items: array<array{sale_item_id: string, quantity: float}>,
     *   reason?: ?string, refund_method?: string, notes?: ?string,
     *   cash_session_id?: ?string, skip_credit_reversal?: bool
     * } $data
     */
    public function execute(Sale $sale, array $data): SaleReturn
    {
        if (! $sale->status->isReturnable()) {
            throw DomainException::conflict('This sale cannot be returned.', 'SALE_NOT_RETURNABLE');
        }

        return DB::transaction(function () use ($sale, $data): SaleReturn {
            $tenantId = $this->context->id();
            $sale->load('items');

            // Refunds are coupon/discount-aware: a sale-level discount was
            // spread across the whole basket, so each returned unit refunds
            // its DISCOUNTED share, never the full sticker price — otherwise
            // refunds could exceed what the customer actually paid.
            $saleSubtotal = (float) $sale->subtotal;
            $saleDiscount = (float) $sale->discount;
            $discountRatio = $saleSubtotal > 0 ? $saleDiscount / $saleSubtotal : 0.0;

            // Tax refunds line-exactly from each line's snapshotted rate; a
            // legacy line without a snapshot falls back to the sale's overall
            // effective rate — either way the customer gets back the tax they
            // paid on what they're returning, never just the pre-tax price.
            $taxableBase = round($saleSubtotal - $saleDiscount, 2);
            $fallbackRate = (float) $sale->tax > 0 && $taxableBase > 0
                ? (float) $sale->tax / $taxableBase * 100
                : 0.0;

            $lines = [];
            $refundBase = 0.0;
            $refundTax = 0.0;

            foreach ($data['items'] as $row) {
                $qty = (float) $row['quantity'];
                if ($qty <= 0) {
                    continue;
                }

                $saleItem = $sale->items->firstWhere('id', $row['sale_item_id']);
                if ($saleItem === null) {
                    throw DomainException::unprocessable('An item does not belong to this sale.', 'RETURN_ITEM_INVALID');
                }

                // Decimal-safe: weight/volume items sell & return fractions
                // (e.g. 2.5 kg) — never truncate to int.
                $alreadyReturned = (float) SaleReturnItem::query()
                    ->where('sale_item_id', $saleItem->id)
                    ->sum('quantity');

                $remaining = round((float) $saleItem->quantity - $alreadyReturned, 3);
                if ($qty > $remaining) {
                    throw DomainException::unprocessable(
                        "Cannot return {$qty} of \"{$saleItem->product_name}\" — only {$remaining} left to return.",
                        'RETURN_QTY_EXCEEDED',
                    );
                }

                // Refund the price actually PAID for the returned units, by
                // CUMULATIVE allocation so sequential partial returns can never
                // drift past what was paid. Rounding each return in isolation
                // (netUnit × qty) repeats the same-signed paisa error every
                // call — three 1-of-3 returns of an 800 line summing to 800.01.
                // Instead: round the exact cumulative refund for everything
                // returned so far, then subtract what was already refunded — the
                // final return absorbs the remainder and the sum lands exact.
                $linePaid = round((float) $saleItem->line_total * (1 - $discountRatio), 2);
                $soldQty = (float) $saleItem->quantity;
                $alreadyRefunded = (float) SaleReturnItem::query()
                    ->where('sale_item_id', $saleItem->id)
                    ->sum('line_total');
                $cumulativeRefund = $soldQty > 0
                    ? round($linePaid * ($alreadyReturned + $qty) / $soldQty, 2)
                    : $linePaid;
                $lineTotal = round($cumulativeRefund - $alreadyRefunded, 2);
                $refundBase = round($refundBase + $lineTotal, 2);

                // Tax this line carried, prorated to the returned share.
                $lineRate = $saleItem->tax_rate !== null ? (float) $saleItem->tax_rate : $fallbackRate;
                $refundTax = round($refundTax + $lineTotal * $lineRate / 100, 2);

                $lines[] = [
                    'tenant_id' => $tenantId,
                    'sale_item_id' => $saleItem->id,
                    'product_id' => $saleItem->product_id,
                    'variant_id' => $saleItem->variant_id,
                    'product_name' => $saleItem->product_name,
                    'variant_name' => $saleItem->variant_name,
                    'quantity' => $qty,
                    'unit_price' => (float) $saleItem->unit_price,
                    'line_total' => $lineTotal,
                    '_item_type' => $saleItem->item_type,
                    // Pack sold: restock draws back factor× the returned count.
                    '_unit_factor' => (float) ($saleItem->unit_factor ?? 1),
                ];
            }

            if (empty($lines)) {
                throw DomainException::unprocessable('Select at least one item to return.', 'RETURN_EMPTY');
            }

            $refundTotal = round($refundBase + $refundTax, 2);

            $seq = SaleReturn::query()->count() + 1;

            /** @var SaleReturn $return */
            $return = SaleReturn::query()->create([
                'tenant_id' => $tenantId,
                'sale_id' => $sale->id,
                'cash_session_id' => $data['cash_session_id'] ?? null,
                'return_number' => 'RET-'.str_pad((string) $seq, 6, '0', STR_PAD_LEFT),
                'refund_total' => $refundTotal,
                'refund_tax' => $refundTax,
                // Refund goes back the way the customer paid, unless overridden.
                'refund_method' => $data['refund_method'] ?? $sale->payment_method->value,
                'reason' => $data['reason'] ?? null,
                'notes' => $data['notes'] ?? null,
                'returned_at' => now(),
                'created_by' => auth()->id(),
            ]);

            foreach ($lines as $line) {
                $itemType = $line['_item_type'];
                $unitFactor = $line['_unit_factor'];
                unset($line['_item_type'], $line['_unit_factor']);
                $return->items()->create($line);

                // Restock only physical, still-tracked products.
                $product = $line['product_id'] !== null
                    ? Product::query()->whereKey($line['product_id'])->first()
                    : null;

                // A returned deal restocks each component (component qty ×
                // returned deal count); a normal product restocks its own stock
                // in BASE units (returned count × unit_factor for a pack).
                if ($product !== null && $product->isCombo()) {
                    foreach ($product->comboItems()->with('component')->get() as $ci) {
                        $component = $ci->component;
                        if ($component !== null && $component->type === ItemType::Product && $component->track_inventory) {
                            $this->inventory->adjust([
                                'product_id' => $component->id,
                                'type' => 'in',
                                'quantity' => round((float) $ci->quantity * (float) $line['quantity'], 3),
                                'reason' => "Return {$return->return_number} (deal: {$product->name})",
                                'reference_type' => 'sale_return',
                                'reference_id' => $return->id,
                                'idempotency_key' => "return-{$return->id}-{$line['sale_item_id']}-c{$component->id}",
                                'branch_id' => $sale->branch_id,
                            ]);
                        }
                    }
                } elseif ($product !== null && $product->hasRecipe()) {
                    // Returning a made-to-order dish puts its ingredients back
                    // (ingredient qty × returned count) — the mirror of the
                    // recipe depletion at sale time.
                    foreach ($product->recipeItems()->with('ingredient')->get() as $ri) {
                        $ingredient = $ri->ingredient;
                        if ($ingredient !== null && $ingredient->type === ItemType::Product && $ingredient->track_inventory) {
                            $this->inventory->adjust([
                                'product_id' => $ingredient->id,
                                'type' => 'in',
                                'quantity' => round((float) $ri->quantity * (float) $line['quantity'], 3),
                                'reason' => "Return {$return->return_number} (recipe: {$product->name})",
                                'reference_type' => 'sale_return',
                                'reference_id' => $return->id,
                                'idempotency_key' => "return-{$return->id}-{$line['sale_item_id']}-i{$ingredient->id}",
                                'branch_id' => $sale->branch_id,
                            ]);
                        }
                    }
                } elseif ($itemType === ItemType::Product->value && $product !== null && $product->track_inventory) {
                    $this->inventory->adjust([
                        'product_id' => $line['product_id'],
                        'variant_id' => $line['variant_id'],
                        'type' => 'in',
                        'quantity' => round((float) $line['quantity'] * $unitFactor, 3),
                        'reason' => "Return {$return->return_number} (sale {$sale->invoice_number})",
                        'reference_type' => 'sale_return',
                        'reference_id' => $return->id,
                        'idempotency_key' => "return-{$return->id}-{$line['sale_item_id']}",
                        'branch_id' => $sale->branch_id,
                    ]);
                }
            }

            // Khata symmetry: if this sale was (partly) charged to the
            // customer's credit, the return reduces what they owe — capped at
            // the sale's still-un-reversed charge so repeated partial returns
            // can never over-reverse. Ledger entry carries the sale id.
            // Exchanges opt OUT (skip_credit_reversal — internal-only, never
            // accepted from HTTP): there the returned value funds the
            // replacement sale, so the debt must stay put.
            if ($sale->customer_id !== null && empty($data['skip_credit_reversal'])) {
                $customer = Customer::query()->whereKey($sale->customer_id)->lockForUpdate()->first();
                $outstanding = $customer?->outstandingCreditForSale($sale->id) ?? 0.0;
                $reverse = round(min($refundTotal, $outstanding), 2);
                if ($customer !== null && $reverse > 0) {
                    $customer->recordCreditPayment(
                        $reverse,
                        'return',
                        $return->return_number,
                        "Return {$return->return_number} against sale {$sale->invoice_number}",
                        $sale->id,
                    );

                    // Record the split so the cashier pays out only the CASH
                    // portion (refund_total − refund_credit) — a khata sale
                    // returned "for cash" must not hand out money the customer
                    // never paid.
                    $return->forceFill(['refund_credit' => $reverse])->save();
                }
            }

            // Recompute sale status from total returned vs sold. Decimal-safe
            // so a fully-returned weight sale (e.g. 2.5 kg) actually lands on
            // Refunded instead of being stuck at PartiallyRefunded.
            $totalSold = round((float) $sale->items->sum('quantity'), 3);
            $totalReturned = round((float) SaleReturnItem::query()
                ->whereIn('sale_item_id', $sale->items->pluck('id'))
                ->sum('quantity'), 3);

            $sale->forceFill([
                'status' => $totalReturned >= $totalSold ? SaleStatus::Refunded : SaleStatus::PartiallyRefunded,
            ])->save();

            return $return->load('items');
        });
    }
}
