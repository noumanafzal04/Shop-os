<?php

namespace App\Support;

/**
 * What a document is printed on, said in a way a browser will obey.
 *
 * ── The report ───────────────────────────────────────────────────────
 *
 *     "Receipt is set to Thermal 80mm, and the till still prints A4."
 *
 * Every roll template wrote `@page { size: 80mm auto }`. That is not CSS. The
 * `size` of a page is one length, two lengths, or a named sheet; "a length
 * and auto" is none of them, so Chrome and Safari drop the declaration and
 * print on the printer's default sheet. Measured, not assumed: the same
 * receipt came out 216mm wide with `80mm auto` and 80mm wide with `80mm
 * 200mm`.
 *
 * Four templates had it (receipt, Z-read, quote/advance, and the kitchen
 * ticket had no size at all), each with its own copy of the vocabulary. This
 * is the one place it is said.
 *
 * ── Why a fixed long edge ────────────────────────────────────────────
 *
 * A roll has no length, and CSS has no way to say "as long as it turns out".
 * So the page declared here is as wide as the roll and as long as an A4
 * sheet — valid everywhere, and right for a receipt opened on its own. The
 * panel, which is where receipts are actually printed from, then measures the
 * receipt and shortens the page to fit it (`fitRoll` in common/print.ts),
 * reading the roll's width from the attributes this class writes on <html>.
 */
final class PrintPaper
{
    /** The longest a roll page is declared before it is fitted: an A4 sheet. */
    private const LONG_EDGE_MM = 297;

    /** The roll's width in millimetres, or null for a sheet. */
    public static function rollMm(?string $width): ?int
    {
        return match ($width) {
            'thermal_58' => 58,
            'thermal_80' => 80,
            default => null,
        };
    }

    /** The value of `@page { size: … }` for this paper. Always valid CSS. */
    public static function pageSize(?string $width): string
    {
        $mm = self::rollMm($width);

        return $mm === null ? 'A4' : "{$mm}mm ".self::LONG_EDGE_MM.'mm';
    }

    /**
     * Attributes for `<html>` that tell whatever prints this which roll it is
     * for. Empty for a sheet: a sheet is its own size and needs no fitting.
     */
    public static function htmlAttributes(?string $width, int $marginMm): string
    {
        $mm = self::rollMm($width);

        return $mm === null ? '' : "data-roll-mm=\"{$mm}\" data-roll-margin-mm=\"{$marginMm}\"";
    }
}
