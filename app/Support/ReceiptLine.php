<?php

namespace App\Support;

use App\Models\Product;
use App\Models\SaleItem;

/**
 * WHAT A LINE ON THE RECEIPT SAYS BESIDE ITS FIGURES.
 *
 * Tester pass 4 (B59), Rehmat Mart: rice weighed at 1.235 kg printed as
 * "1.235 × 320.50" — 1.235 of what? — and five bottles of oil at the bulk
 * rate of 550 printed with no word of why they were cheaper than the 560 on
 * the shelf. The till says both; the paper the customer takes home did not.
 *
 * Read off the item as it is now (its unit and its bulk rates), because the
 * line keeps its price and quantity but not those. A line that is a pack
 * ("Carton of 24") or a size already says what it is, and is left alone.
 */
final class ReceiptLine
{
    /** "1.235 kg" for an item sold by weight; the plain count otherwise. */
    public static function quantity(SaleItem $item): string
    {
        $n = self::number((float) $item->quantity);
        $product = self::product($item);

        if ($product?->sold_by === 'weight' && $item->unit_name === null) {
            return trim($n.' '.(trim((string) $product->unit) ?: 'kg'));
        }

        return $n;
    }

    /** "Bulk price, 5 or more" when the line was rung at a bulk rate; null otherwise. */
    public static function priceNote(SaleItem $item): ?string
    {
        $product = self::product($item);
        if ($product === null || $item->variant_id !== null || $item->unit_name !== null) {
            return null;
        }

        // The line keeps the price it was charged; a bulk rate is the one it
        // equals, below the shelf price. (Only a quantity that reached the
        // rate is ever charged it — see Product::priceForQty.)
        $charged = round((float) $item->unit_price, 2);

        foreach ($product->price_tiers ?? [] as $tier) {
            $min = (float) ($tier['min_qty'] ?? 0);
            $price = round((float) ($tier['price'] ?? 0), 2);

            if ($min > 0 && $price === $charged && $price < round($product->sellingPrice(), 2)) {
                return 'Bulk price, '.self::number($min).' or more';
            }
        }

        return null;
    }

    private static function product(SaleItem $item): ?Product
    {
        return $item->relationLoaded('product') ? $item->product : null;
    }

    private static function number(float $n): string
    {
        return rtrim(rtrim(number_format($n, 3, '.', ''), '0'), '.') ?: '0';
    }
}
