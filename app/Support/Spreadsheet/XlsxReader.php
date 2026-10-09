<?php

namespace App\Support\Spreadsheet;

use RuntimeException;
use XMLReader;

/**
 * The cells of one worksheet, as the text a person sees.
 *
 * Not a spreadsheet engine: no formulas are worked out (Excel stores the last
 * answer beside each one, and that is what is read), no styles, no charts. A
 * catalogue file is a grid of words and numbers and this reads the grid.
 *
 * ── The two things that are easy to get wrong ───────────────────────────
 *
 * NUMBERS. Excel stores 8961234567890 as `8961234567890`, and sometimes as
 * `8.96123456789E12`, and 0.3 as `0.30000000000000004`. All three are given
 * back the way they were typed. A barcode is the reason this matters: it is a
 * number to Excel and an identity to a shop.
 *
 * GAPS. An empty cell is simply absent from the file, so the third cell of a
 * row may be column G. Every cell says where it is (`r="G7"`), and the row is
 * filled out to match — or a price lands under Barcode.
 */
final class XlsxReader
{
    private const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

    /**
     * @return array<int, array<int, string>> row number in the sheet (1-based) => cells
     */
    public static function rows(string $bytes, ?string $preferSheet = null, int $maxRows = 100_000): array
    {
        $zip = Zip::open($bytes);

        $path = self::sheetPath($zip, $preferSheet);
        $sheet = $zip->get($path);
        if ($sheet === null) {
            throw new RuntimeException('This .xlsx has no worksheet in it.');
        }

        $strings = self::sharedStrings($zip->get('xl/sharedStrings.xml'));

        return self::cells($sheet, $strings, $maxRows);
    }

    /** The sheet asked for by name, else the first one a person can see. */
    private static function sheetPath(Zip $zip, ?string $prefer): string
    {
        $workbook = $zip->get('xl/workbook.xml');
        $rels = $zip->get('xl/_rels/workbook.xml.rels');
        if ($workbook === null || $rels === null) {
            throw new RuntimeException('This file is not an Excel workbook (.xlsx).');
        }

        $targets = [];
        $x = self::xml($rels);
        while ($x->read()) {
            if ($x->nodeType === XMLReader::ELEMENT && $x->localName === 'Relationship') {
                $targets[(string) $x->getAttribute('Id')] = (string) $x->getAttribute('Target');
            }
        }

        $first = null;
        $named = null;
        $x = self::xml($workbook);
        while ($x->read()) {
            if ($x->nodeType !== XMLReader::ELEMENT || $x->localName !== 'sheet') {
                continue;
            }

            $target = $targets[(string) $x->getAttributeNs('id', self::NS_REL)] ?? null;
            if ($target === null) {
                continue;
            }

            $hidden = in_array((string) $x->getAttribute('state'), ['hidden', 'veryHidden'], true);
            if ($prefer !== null && strcasecmp((string) $x->getAttribute('name'), $prefer) === 0) {
                $named = $target;
            }
            if ($first === null && ! $hidden) {
                $first = $target;
            }
        }

        $target = $named ?? $first;
        if ($target === null) {
            throw new RuntimeException('This .xlsx has no worksheet in it.');
        }

        // "worksheets/sheet1.xml" is relative to xl/; "/xl/worksheets/sheet1.xml" is not.
        return str_starts_with($target, '/') ? ltrim($target, '/') : 'xl/'.$target;
    }

    /** @return array<int, string> */
    private static function sharedStrings(?string $xml): array
    {
        if ($xml === null) {
            return [];
        }

        $strings = [];
        $x = self::xml($xml);
        $inItem = false;
        $inPhonetic = false;
        $text = '';

        while ($x->read()) {
            if ($x->nodeType === XMLReader::ELEMENT) {
                if ($x->localName === 'si') {
                    $inItem = true;
                    $text = '';
                    if ($x->isEmptyElement) {
                        $strings[] = '';
                        $inItem = false;
                    }
                } elseif ($x->localName === 'rPh') {
                    // Phonetic guides (furigana) ride along inside the string.
                    $inPhonetic = ! $x->isEmptyElement;
                } elseif ($inItem && ! $inPhonetic && $x->localName === 't' && ! $x->isEmptyElement) {
                    $text .= $x->readString();
                }
            } elseif ($x->nodeType === XMLReader::END_ELEMENT) {
                if ($x->localName === 'si') {
                    $strings[] = $text;
                    $inItem = false;
                } elseif ($x->localName === 'rPh') {
                    $inPhonetic = false;
                }
            }
        }

        return $strings;
    }

    /**
     * @param  array<int, string>  $strings
     * @return array<int, array<int, string>>
     */
    private static function cells(string $xml, array $strings, int $maxRows): array
    {
        $rows = [];
        $x = self::xml($xml);
        $rowNo = 0;

        while ($x->read()) {
            if ($x->nodeType !== XMLReader::ELEMENT || $x->localName !== 'row') {
                continue;
            }

            $rowNo = $x->getAttribute('r') !== null ? (int) $x->getAttribute('r') : $rowNo + 1;
            if ($x->isEmptyElement) {
                continue;
            }

            $cells = [];
            $next = 0;
            $depth = $x->depth;

            while ($x->read() && ! ($x->nodeType === XMLReader::END_ELEMENT && $x->depth === $depth)) {
                if ($x->nodeType !== XMLReader::ELEMENT || $x->localName !== 'c') {
                    continue;
                }

                $ref = (string) $x->getAttribute('r');
                $col = $ref !== '' ? self::column($ref) : $next;
                $type = (string) $x->getAttribute('t');
                $value = $x->isEmptyElement ? '' : self::value($x, $type, $strings);

                $cells[$col] = $value;
                $next = $col + 1;
            }

            if ($cells !== []) {
                $width = max(array_keys($cells)) + 1;
                $full = array_fill(0, $width, '');
                foreach ($cells as $col => $value) {
                    $full[$col] = $value;
                }
                $rows[$rowNo] = $full;
            }

            if (count($rows) > $maxRows) {
                break;
            }
        }

        return $rows;
    }

    /** One `<c>`: its `<v>` or its inline string, read as its type says. */
    private static function value(XMLReader $x, string $type, array $strings): string
    {
        $raw = '';
        $inline = '';
        $depth = $x->depth;

        while ($x->read() && ! ($x->nodeType === XMLReader::END_ELEMENT && $x->depth === $depth)) {
            if ($x->nodeType !== XMLReader::ELEMENT || $x->isEmptyElement) {
                continue;
            }
            if ($x->localName === 'v') {
                $raw = $x->readString();
            } elseif ($x->localName === 't') {
                $inline .= $x->readString();
            }
        }

        return match ($type) {
            's' => $strings[(int) $raw] ?? '',
            'inlineStr' => $inline,
            'str' => $raw,
            'b' => $raw === '1' ? 'TRUE' : 'FALSE',
            'e' => '',
            default => self::number($raw),
        };
    }

    /** A number as it was typed, not as a float prints. */
    public static function number(string $raw): string
    {
        $raw = trim($raw);
        if ($raw === '' || preg_match('/^-?\d+$/', $raw) === 1 || ! is_numeric($raw)) {
            return $raw;
        }

        $n = (float) $raw;

        // Whole, and small enough for a double to hold exactly: a barcode, a
        // quantity, a price in rupees.
        if (floor($n) === $n && abs($n) < 1e15) {
            return number_format($n, 0, '', '');
        }

        return rtrim(rtrim(number_format($n, 10, '.', ''), '0'), '.');
    }

    /** "G7" → 6. */
    private static function column(string $ref): int
    {
        $n = 0;
        foreach (str_split(preg_replace('/[^A-Z]/', '', strtoupper($ref)) ?? '') as $letter) {
            $n = $n * 26 + (ord($letter) - 64);
        }

        return max(0, $n - 1);
    }

    private static function xml(string $source): XMLReader
    {
        $reader = new XMLReader;
        // No network, and entities are left alone: a spreadsheet has no
        // business naming a file on this server.
        if (! $reader->XML($source, null, LIBXML_NONET | LIBXML_COMPACT)) {
            throw new RuntimeException('This .xlsx is damaged.');
        }

        return $reader;
    }
}
