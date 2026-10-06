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

    /**
     * The blank edge round a roll's printing, on every side, in millimetres.
     *
     * Two reasons, and the second is why it is PADDING inside the document
     * and not a margin on the page.
     *
     * A thermal head is narrower than its paper: an 80mm roll prints about
     * 72mm across and a 58mm roll about 48mm, so anything closer than 4–5mm
     * to the edge is not printed at all.
     *
     * And a page margin is the print window's to give or take. With "Margins:
     * None" chosen there — once, by anybody, and the browser remembers — a
     * margin written in CSS is thrown away and the receipt runs to the edge
     * of the paper: "edges ke sath lagi hui invoices". Padding belongs to the
     * document and comes out the same whatever that menu says. So a roll's
     * page has NO margin, and every roll template pads itself by this much,
     * on screen and on paper alike — which also means the height the panel
     * measures on screen is the height that prints.
     */
    public const ROLL_EDGE_MM = 5;

    /** `5mm` — for a template's own padding. */
    public static function rollEdge(): string
    {
        return self::ROLL_EDGE_MM.'mm';
    }

    /** The roll's width in millimetres, or null for a sheet. */
    public static function rollMm(?string $width): ?int
    {
        return match ($width) {
            'thermal_58' => 58,
            'thermal_80' => 80,
            default => null,
        };
    }

    /** The value of `@page { margin: … }`: a roll's own, or what a sheet asks for. */
    public static function pageMargin(?string $width, string $sheet): string
    {
        // A roll's edge is the document's own padding. See ROLL_EDGE_MM.
        return self::rollMm($width) === null ? $sheet : '0';
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
    public static function htmlAttributes(?string $width, int $marginMm = 0): string
    {
        $mm = self::rollMm($width);

        return $mm === null ? '' : "data-roll-mm=\"{$mm}\" data-roll-margin-mm=\"{$marginMm}\"";
    }
}
