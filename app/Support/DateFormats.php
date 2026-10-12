<?php

namespace App\Support;

use DateTimeInterface;
use Illuminate\Support\Carbon;

/**
 * HOW A SHOP WRITES A DATE.
 *
 *     "date ka format setting main hona chahye — for international?"
 *
 * The panel wrote every date the way the BROWSER it happened to be opened in
 * writes dates, so on one laptop the twelfth of October was "10/12/2026" —
 * which a shopkeeper in Lahore reads as the tenth of December — and on the
 * next it was "12/10/2026". The papers wrote "12 Oct 2026" whatever anybody
 * wanted. A date is one of the few things on a receipt that two people have to
 * read the same way.
 *
 * So a shop chooses, once, from a short list — and the default is the one
 * that cannot be misread. The CODE is what is stored (`settings.date_format`);
 * the patterns live here and nowhere else, and the panel is held to the same
 * outputs by a fixture this side writes (`tests/fixtures/date-format.json`).
 */
final class DateFormats
{
    /** Day, the month's name, the year: there is no second way to read it. */
    public const DEFAULT = 'dmy_text';

    /**
     * code => how the whole date is written, and how it is written where the
     * year goes without saying (a slip number's line, a chart's axis).
     *
     * @var array<string, array{long: string, short: string}>
     */
    public const LIST = [
        // No leading nought on the day: "5 Oct 2026" is how it is said. The
        // three in numbers keep theirs, as dates in numbers are written.
        'dmy_text' => ['long' => 'j M Y', 'short' => 'j M'],   // 12 Oct 2026 · 5 Oct 2026
        'dmy' => ['long' => 'd/m/Y', 'short' => 'd/m'],        // 12/10/2026 — Pakistan, India, the UK, the Gulf
        'mdy' => ['long' => 'm/d/Y', 'short' => 'm/d'],        // 10/12/2026 — the United States
        'ymd' => ['long' => 'Y-m-d', 'short' => 'm-d'],        // 2026-10-12
    ];

    /** A day nobody can read two ways in ANY of them but the two it is there to tell apart. */
    private const EXAMPLE = '2026-10-12';

    /** @return list<string> */
    public static function codes(): array
    {
        return array_keys(self::LIST);
    }

    /** The code, or the default for one this list does not hold. */
    public static function code(?string $code): string
    {
        return $code !== null && isset(self::LIST[$code]) ? $code : self::DEFAULT;
    }

    public static function pattern(?string $code): string
    {
        return self::LIST[self::code($code)]['long'];
    }

    public static function shortPattern(?string $code): string
    {
        return self::LIST[self::code($code)]['short'];
    }

    /**
     * A paper's own format, with its DATE written the shop's way.
     *
     * Every paper writes its date as `d M Y` (or `j M Y`) and whatever it
     * likes around it — "d M Y · h:i A" on a receipt, "d M Y, H:i" on a
     * Z-read. That one run of letters is the date; this swaps it for the
     * shop's, and leaves the clock, the commas and a machine's `Y-m-d` alone.
     */
    public static function localise(string $format, ?string $code): string
    {
        $code = self::code($code);

        $format = preg_replace('/\b[dj] M Y\b/', self::LIST[$code]['long'], $format) ?? $format;

        // …and the same date where the paper leaves the year off.
        return preg_replace('/\b[dj] M\b(?! Y)/', self::LIST[$code]['short'], $format) ?? $format;
    }

    /**
     * A calendar day, written the shop's way — "valid until", "warranty to",
     * "expires". A day is not a moment: it is never moved to a time zone.
     */
    public static function day(DateTimeInterface|string|null $day, ?string $code, bool $withYear = true): string
    {
        if ($day === null || $day === '') {
            return '';
        }

        $date = $day instanceof DateTimeInterface ? Carbon::instance($day) : Carbon::parse($day);

        return $date->format($withYear ? self::pattern($code) : self::shortPattern($code));
    }

    /**
     * The list a settings screen offers, each shown as it writes one day.
     *
     * @return list<array{code: string, example: string}>
     */
    public static function options(): array
    {
        return array_map(
            fn (string $code): array => ['code' => $code, 'example' => self::day(self::EXAMPLE, $code)],
            self::codes(),
        );
    }
}
