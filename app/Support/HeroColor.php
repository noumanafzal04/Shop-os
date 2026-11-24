<?php

namespace App\Support;

/**
 * CAN WHITE BE READ ON THIS COLOUR?
 *
 * The home's top block is drawn for a DARK ground: the address, the search
 * hint, the status bar's glyphs and the banner's own words are all white. An
 * admin-chosen colour becomes that ground, so a pale one (yellow, light grey)
 * would leave the header unreadable on every phone.
 *
 * WCAG's large-text bar, 3:1 against white — the header's words are 15–24 pt
 * bold. Same formula in the panel (`heroColor.ts`) as a pre-flight; this is
 * the gate.
 */
final class HeroColor
{
    public const MIN_CONTRAST = 3.0;

    public static function valid(string $hex): bool
    {
        return (bool) preg_match('/^#[0-9a-fA-F]{6}$/', $hex);
    }

    public static function contrastWithWhite(string $hex): float
    {
        $l = self::luminance($hex);

        return round(1.05 / ($l + 0.05), 2);
    }

    public static function readsUnderWhite(string $hex): bool
    {
        return self::contrastWithWhite($hex) >= self::MIN_CONTRAST;
    }

    private static function luminance(string $hex): float
    {
        $rgb = array_map(
            fn (string $pair): float => hexdec($pair) / 255,
            str_split(ltrim($hex, '#'), 2),
        );
        $lin = array_map(
            fn (float $c): float => $c <= 0.03928 ? $c / 12.92 : (($c + 0.055) / 1.055) ** 2.4,
            $rgb,
        );

        return 0.2126 * $lin[0] + 0.7152 * $lin[1] + 0.0722 * $lin[2];
    }
}
