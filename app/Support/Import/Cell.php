<?php

namespace App\Support\Import;

use App\Support\ItemTypes;
use Carbon\CarbonImmutable;
use Throwable;

/**
 * One cell of a shopkeeper's sheet, read as they meant it.
 *
 * Each of these returns the value, or `null` when the cell does not say one —
 * and the caller turns that into a sentence about THAT cell. The importer used
 * to hand the raw text to a validator, which is why "2,850" was "not a number"
 * and a barcode Excel had turned into 8.96E+12 was saved as a barcode.
 */
final class Cell
{
    /** Money and quantities: "2,850", "Rs 2,500.50", "1 200", "17%". */
    public static function number(string $raw): ?float
    {
        $s = preg_replace('/(?i)\b(rs\.?|pkr|rupees?)\b|[\s,%\x{00A0}]/u', '', trim($raw)) ?? '';

        return $s !== '' && preg_match('/^-?\d+(\.\d+)?$/', $s) === 1 ? (float) $s : null;
    }

    /** Yes / No, the ways a sheet says it. */
    public static function truth(string $raw): ?bool
    {
        return match (mb_strtolower(trim($raw))) {
            '1', 'true', 'yes', 'y', 'on', 'active', 'haan', 'han' => true,
            '0', 'false', 'no', 'n', 'off', 'inactive', 'nahi' => false,
            default => null,
        };
    }

    /**
     * A barcode, SKU or PLU, kept as text.
     *
     * Excel shows a long number as 8.96E+12 and SAVES it that way in a CSV: the
     * digits after the fifth are gone for good, and what is left is not a
     * barcode. That is said, never stored.
     *
     * @return array{0: ?string, 1: bool} the code, and whether Excel has damaged it
     */
    public static function code(string $raw): array
    {
        $s = trim($raw);

        if (preg_match('/^\d(\.\d+)?E\+?\d+$/i', $s) === 1) {
            return [null, true];
        }

        // A number cell exported with a decimal point it never had.
        if (preg_match('/^(\d+)\.0+$/', $s, $m) === 1) {
            $s = $m[1];
        }

        return [$s !== '' ? $s : null, false];
    }

    /**
     * The kind of item, by its code or by the words on the screen. Whether
     * THIS shop keeps that kind is the caller's question, not this one's.
     */
    public static function itemType(string $raw): ?string
    {
        $said = self::plain($raw);

        foreach (ItemTypes::all() as $code => $profile) {
            $names = [self::plain($code), self::plain((string) ($profile['label'] ?? ''))];
            // "Food", "Product", "Physical": the first word is enough.
            $names[] = self::plain(explode(' ', (string) ($profile['label'] ?? ''))[0]);
            if ($code === ItemTypes::PHYSICAL) {
                $names[] = 'product';
            }

            if (in_array($said, $names, true)) {
                return $code;
            }
        }

        return null;
    }

    /** By the piece, or by weight / measure. */
    public static function soldBy(string $raw): ?string
    {
        return match (self::plain($raw)) {
            'unit', 'piece', 'pieces', 'each', 'pcs', 'item', 'count' => 'unit',
            'weight', 'measure', 'kg', 'loose', 'weight measure', 'litre', 'liter' => 'weight',
            default => null,
        };
    }

    /**
     * A date as a sheet holds one.
     *
     * Day first, because that is how it is written here: 03/04/2027 is the
     * third of April. A month and a year ("03/2027", "Mar 2027") is the LAST
     * day of that month — a strip printed EXP 03/2027 is good until the 31st.
     * A bare number is Excel's own count of days, which is how a date cell
     * arrives from an .xlsx.
     */
    public static function date(string $raw): ?string
    {
        $s = trim($raw);
        if ($s === '') {
            return null;
        }

        try {
            if (preg_match('/^\d{5}(\.\d+)?$/', $s) === 1) {
                return CarbonImmutable::create(1899, 12, 30)->addDays((int) $s)->toDateString();
            }
            if (preg_match('/^(\d{4})-(\d{1,2})-(\d{1,2})/', $s, $m) === 1) {
                return self::ymd((int) $m[1], (int) $m[2], (int) $m[3]);
            }
            if (preg_match('/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/', $s, $m) === 1) {
                return self::ymd(self::year((int) $m[3]), (int) $m[2], (int) $m[1]);
            }
            if (preg_match('/^(\d{1,2})[\/.\-](\d{2,4})$/', $s, $m) === 1) {
                return self::endOfMonth(self::year((int) $m[2]), (int) $m[1]);
            }
            if (preg_match('/^([A-Za-z]{3,9})[\s\-\/,]+(\d{2,4})$/', $s, $m) === 1) {
                $month = self::month($m[1]);

                return $month !== null ? self::endOfMonth(self::year((int) $m[2]), $month) : null;
            }
            if (preg_match('/^(\d{1,2})[\s\-]+([A-Za-z]{3,9})[\s\-,]+(\d{2,4})$/', $s, $m) === 1) {
                $month = self::month($m[2]);

                return $month !== null ? self::ymd(self::year((int) $m[3]), $month, (int) $m[1]) : null;
            }
        } catch (Throwable) {
            return null;
        }

        return null;
    }

    private static function ymd(int $y, int $m, int $d): ?string
    {
        return checkdate($m, $d, $y) ? sprintf('%04d-%02d-%02d', $y, $m, $d) : null;
    }

    private static function endOfMonth(int $y, int $m): ?string
    {
        return $m >= 1 && $m <= 12 ? self::ymd($y, $m, (int) date('t', (int) mktime(0, 0, 0, $m, 1, $y))) : null;
    }

    /** "Mar", "March" → 3. A word that is not a month is not January. */
    private static function month(string $name): ?int
    {
        $at = strtotime('1 '.$name.' 2000');

        return $at !== false ? (int) date('n', $at) : null;
    }

    private static function year(int $y): int
    {
        return $y < 100 ? 2000 + $y : $y;
    }

    private static function plain(string $s): string
    {
        return trim((string) preg_replace('/[^a-z0-9]+/', ' ', mb_strtolower($s)));
    }
}
