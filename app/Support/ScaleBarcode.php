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

    /** How many of a PRICE label's five digits are paisa: 0, or 2. Anything else is 0. */
    public static function decimals(array $settings): int
    {
        return (int) ($settings['scale_price_decimals'] ?? 0) === 2 ? 2 : 0;
    }

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
            // What the item COSTS, in rupees; null in weight mode.
            //
            // WHOLE RUPEES, unless the shop says its scale prints paisa.
            //
            // This read the five digits as hundredths, always — so "00450"
            // was Rs 4.50, and the most a label could say was Rs 999.99: less
            // than a kilo of mutton. Nobody here prices in paisa; a scale set
            // up for rupees printed 450 and the till charged four and a half.
            // `scale_price_decimals` is 0 (the default) or 2.
            'price' => $mode === 'price' ? round($rawValue / (10 ** self::decimals($settings)), 2) : null,
        ];
    }
}
