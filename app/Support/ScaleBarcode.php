<?php

namespace App\Support;

/**
 * Parser for the EAN-13 "embedded" barcodes that grocery/deli weighing scales
 * print for loose items (loose sugar, meat, vegetables, cheese…). The scale
 * weighs the item and prints a store-only barcode that carries BOTH the item's
 * PLU code AND either the measured weight or the computed price.
 *
 * These barcodes are in the GS1 "restricted circulation" range — they only
 * mean anything inside the shop that printed them — so parsing is OFF by
 * default and gated behind a per-shop setting (scale_barcode_*).
 *
 * Layout (13 digits), prefix-length aware so both the 1-digit "2…" and the
 * 2-digit "20–29" conventions work:
 *
 *     [ prefix ][ item/PLU code ][ value (5) ][ check (1) ]
 *
 *   prefix     configured flag (e.g. "2" or "21")
 *   item code  the digits between the prefix and the value — matched against
 *              a product's plu_code
 *   value      5 digits: grams (weight mode) or currency-minor-units (price mode)
 *   check      the trailing EAN check digit (ignored — scanners already verify)
 *
 * Weight mode is server-authoritative: we take only the WEIGHT from the label
 * and the shop's own per-unit price still decides what the customer pays.
 * Price mode trusts the price the scale computed (the scale holds the rate).
 */
class ScaleBarcode
{
    /** Digits reserved for the embedded weight/price value. */
    private const VALUE_LEN = 5;

    /**
     * Parse a scanned code against a shop's scale config, or return null when
     * it isn't a scale barcode (normal product/EAN → caller looks it up as-is).
     *
     * @param  array{scale_barcode_enabled?: bool, scale_barcode_prefix?: string, scale_barcode_mode?: string}  $settings
     * @return array{item_code: string, mode: string, weight: float|null, price: float|null}|null
     */
    public static function parse(string $code, array $settings): ?array
    {
        if (! ($settings['scale_barcode_enabled'] ?? false)) {
            return null;
        }

        $code = trim($code);
        $prefix = (string) ($settings['scale_barcode_prefix'] ?? '2');
        $mode = ($settings['scale_barcode_mode'] ?? 'weight') === 'price' ? 'price' : 'weight';

        // Must be exactly 13 numeric digits carrying the shop's flag prefix,
        // with room left for a non-empty item code plus value + check digit.
        $itemLen = 13 - strlen($prefix) - self::VALUE_LEN - 1;
        if ($prefix === '' || $itemLen < 1
            || strlen($code) !== 13 || ! ctype_digit($code)
            || ! str_starts_with($code, $prefix)) {
            return null;
        }

        $itemCode = substr($code, strlen($prefix), $itemLen);
        $rawValue = (int) substr($code, strlen($prefix) + $itemLen, self::VALUE_LEN);

        return [
            'item_code' => $itemCode,
            'mode' => $mode,
            // Weight in kg (label carries grams); null in price mode.
            'weight' => $mode === 'weight' ? round($rawValue / 1000, 3) : null,
            // Price in major currency units (label carries minor units); null in weight mode.
            'price' => $mode === 'price' ? round($rawValue / 100, 2) : null,
        ];
    }
}
