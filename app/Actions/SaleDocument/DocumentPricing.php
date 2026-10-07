<?php

namespace App\Actions\SaleDocument;

use App\Exceptions\DomainException;
use App\Models\BranchPrice;
use App\Models\Product;
use App\Models\ProductUnit;
use App\Models\ProductVariant;

/**
 * HOW A LINE ON A DOCUMENT IS PRICED — once, for every door that writes one.
 *
 * A quotation, a layaway and a job card are priced off the shop's own price
 * list: the price level, the customer group's level, a branch's override, a
 * pack unit. That used to live inside `CreateSaleDocumentAction`, which was
 * the only thing that ever wrote a line — and a job card is a document whose
 * lines go on over hours, after it was created. A second copy of this would
 * have been a second answer to "what does this part cost on this job?".
 */
final class DocumentPricing
{
    /**
     * Price one line.
     *
     * @param  array{product_id: string, variant_id?: ?string, product_unit_id?: ?string, quantity: float|int|string, price_level?: ?string, line_discount?: mixed, line_discount_pct?: mixed}  $item
     * @return array{product: Product, variant: ?ProductVariant, unit: ?ProductUnit, factor: float, quantity: float, unit_price: float, line_discount: float, line_total: float, tax_rate: float}
     */
    public static function line(array $item, ?string $branchId, string $groupPriceLevel, float $defaultTaxRate): array
    {
        /** @var Product|null $product */
        $product = Product::query()
            ->whereKey($item['product_id'])
            ->where('is_active', true)
            ->first();

        if ($product === null) {
            throw DomainException::unprocessable(
                'An item on this document is no longer available.',
                'PRODUCT_UNAVAILABLE',
            );
        }

        $variant = null;
        if (! empty($item['variant_id'])) {
            $variant = ProductVariant::query()
                ->whereKey($item['variant_id'])
                ->where('product_id', $product->id)
                ->where('is_active', true)
                ->first();

            if ($variant === null) {
                throw DomainException::unprocessable(
                    'A variant on this document is no longer available.',
                    'VARIANT_UNAVAILABLE',
                );
            }
        }

        $quantity = (float) $item['quantity'];

        if ($product->sold_by !== 'weight' && fmod($quantity, 1.0) !== 0.0) {
            throw DomainException::unprocessable(
                "\"{$product->name}\" is sold by unit — enter a whole quantity.",
                'FRACTIONAL_QTY_NOT_ALLOWED',
            );
        }

        $unit = null;
        if ($variant === null && ! empty($item['product_unit_id'])) {
            $unit = ProductUnit::query()
                ->whereKey($item['product_unit_id'])
                ->where('product_id', $product->id)
                ->first();

            if ($unit === null) {
                throw DomainException::unprocessable(
                    'A pack unit on this document is no longer available.',
                    'UNIT_UNAVAILABLE',
                );
            }
        }
        $factor = $unit !== null ? (float) $unit->factor : 1.0;

        $level = ($item['price_level'] ?? $groupPriceLevel) === 'wholesale' ? 'wholesale' : 'retail';
        $levelUnit = $product->priceForLevel($level, $quantity);

        $override = self::branchPrice($branchId, $product->id, $variant?->id);
        if ($override !== null && $level === 'retail' && $variant === null) {
            $levelUnit = $override;
        }

        $unitPrice = round($unit !== null
            ? $unit->priceUsing($levelUnit)
            : ($variant !== null ? ($override ?? (float) $variant->price) : $levelUnit), 2);

        $gross = round($unitPrice * $quantity, 2);

        $lineDiscount = 0.0;
        if (($pct = (float) ($item['line_discount_pct'] ?? 0)) > 0) {
            $lineDiscount = round($gross * min($pct, 100) / 100, 2);
        } elseif (($amt = (float) ($item['line_discount'] ?? 0)) > 0) {
            $lineDiscount = min(round($amt, 2), $gross);
        }

        return [
            'product' => $product,
            'variant' => $variant,
            'unit' => $unit,
            'factor' => $factor,
            'quantity' => $quantity,
            'unit_price' => $unitPrice,
            'line_discount' => $lineDiscount,
            'line_total' => round($gross - $lineDiscount, 2),
            'tax_rate' => $product->effectiveTaxRate($defaultTaxRate),
        ];
    }

    /**
     * Server-authoritative tax, per line, on each line's discounted share —
     * the same arithmetic CreateSaleAction uses, so the quoted tax and the
     * charged tax cannot disagree.
     *
     * @param  iterable<array{line_total: float|string, tax_rate: float|string|null}>  $lines
     */
    public static function tax(iterable $lines, float $subtotal, float $discount, bool $inclusive): float
    {
        $taxableBase = $subtotal - $discount;
        $tax = 0.0;

        foreach ($lines as $line) {
            $rate = (float) $line['tax_rate'];
            if ($rate <= 0 || $subtotal <= 0) {
                continue;
            }

            $lineShare = (float) $line['line_total'] * ($taxableBase / $subtotal);

            if ($inclusive) {
                $net = $lineShare / (1 + $rate / 100);
                $tax = round($tax + ($lineShare - $net), 2);
            } else {
                $tax = round($tax + $lineShare * $rate / 100, 2);
            }
        }

        return $tax;
    }

    private static function branchPrice(?string $branchId, string $productId, ?string $variantId): ?float
    {
        if ($branchId === null) {
            return null;
        }

        $query = BranchPrice::query()
            ->where('branch_id', $branchId)
            ->where('product_id', $productId);

        $variantId === null
            ? $query->whereNull('variant_id')
            : $query->where('variant_id', $variantId);

        $price = $query->value('price');

        return $price !== null ? (float) $price : null;
    }
}
