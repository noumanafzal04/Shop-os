<?php

namespace App\Support;

use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\PurchaseOrderItem;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\StockMovement;
use Carbon\CarbonInterface;

/**
 * Put right what a size cost on the sales rung before sizes were costed.
 *
 * Until 2026-10-13 a sale line for a size was costed at the DESIGN's cost
 * (UnitCost), so margins and profit for a clothing shop were worked out from
 * the wrong figure. This mends those lines — and ONLY from a record: the
 * purchase receipt for that very size, the last one that had landed before the
 * sale was rung, at the price on its order line (per piece, then times the
 * pack the line was sold in). A line with no such receipt is left exactly as it
 * is and counted, never given a figure somebody worked out. A cooked dish is
 * costed by its recipe, not by what was bought, and is left alone.
 *
 * Nothing is written unless asked: `apply: false` says what would change.
 */
final class SizeCostsFromPurchases
{
    /**
     * @return array{looked_at: int, changed: int, already_right: int, no_record: int, cooked: int, changes: list<array{sale: string, line: string, size: string, was: ?float, now: float, from: string}>}
     */
    public static function mend(CarbonInterface $until, ?string $tenantId, bool $apply): array
    {
        $report = ['looked_at' => 0, 'changed' => 0, 'already_right' => 0, 'no_record' => 0, 'cooked' => 0, 'changes' => []];

        SaleItem::withoutTenancy()
            ->whereNotNull('sale_items.variant_id')
            ->when($tenantId !== null, fn ($q) => $q->where('sale_items.tenant_id', $tenantId))
            ->whereIn('sale_items.sale_id', Sale::withoutTenancy()->select('id')->where('sold_at', '<=', $until))
            ->orderBy('sale_items.id')
            ->chunkById(200, function ($lines) use (&$report, $apply): void {
                foreach ($lines as $line) {
                    $report['looked_at']++;
                    $soldAt = Sale::withoutTenancy()->whereKey($line->sale_id)->value('sold_at');
                    $product = Product::withoutTenancy()->find($line->product_id);
                    $size = ProductVariant::withoutTenancy()->find($line->variant_id);

                    if ($product !== null && RecipeCost::forDish($product, [], $size) !== null) {
                        $report['cooked']++;

                        continue;
                    }

                    $receipt = self::lastReceipt($line->tenant_id, $line->variant_id, $soldAt);
                    if ($receipt === null) {
                        $report['no_record']++;

                        continue;
                    }

                    $factor = (float) ($line->unit_factor ?? 1) ?: 1.0;
                    $now = round($receipt['each'] * $factor, 2);
                    $was = $line->unit_cost === null ? null : (float) $line->unit_cost;

                    if ($was !== null && abs($was - $now) < 0.005) {
                        $report['already_right']++;

                        continue;
                    }

                    $report['changed']++;
                    $report['changes'][] = [
                        'sale' => (string) Sale::withoutTenancy()->whereKey($line->sale_id)->value('invoice_number'),
                        'line' => (string) $line->id,
                        'size' => trim("{$line->product_name} {$line->variant_name}"),
                        'was' => $was,
                        'now' => $now,
                        'from' => $receipt['po'],
                    ];

                    if ($apply) {
                        SaleItem::withoutTenancy()->whereKey($line->id)->toBase()->update(['unit_cost' => $now]);
                    }
                }
            }, 'sale_items.id', 'id');

        return $report;
    }

    /**
     * The last delivery of this size that had landed by then, and what one
     * piece of it cost on its order line.
     *
     * @return array{each: float, po: string}|null
     */
    private static function lastReceipt(string $tenantId, string $variantId, mixed $soldAt): ?array
    {
        $receipts = StockMovement::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->where('variant_id', $variantId)
            ->where('reference_type', 'purchase_order')
            ->where('type', 'in')
            ->where('created_at', '<=', $soldAt)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->pluck('reference_id');

        foreach ($receipts->unique() as $poId) {
            $item = PurchaseOrderItem::withoutTenancy()
                ->where('purchase_order_id', $poId)
                ->where('variant_id', $variantId)
                ->whereNotNull('unit_cost')
                ->with('purchaseOrder:id,po_number')
                ->first();

            if ($item !== null) {
                $factor = (float) ($item->unit_factor ?? 1) ?: 1.0;

                return ['each' => (float) $item->unit_cost / $factor, 'po' => (string) ($item->purchaseOrder?->po_number ?? $poId)];
            }
        }

        return null;
    }
}
