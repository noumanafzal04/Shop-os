<?php

namespace App\Support\Spreadsheet;

use App\Exceptions\DomainException;
use RuntimeException;

/**
 * A file a shopkeeper uploaded, as a header and its rows.
 *
 * The importer used to split the upload on newlines and each line on commas.
 * That reads the file a programmer exports and not the one Excel writes:
 *
 *   a description with a line break in it was two rows, both wrong
 *   a file from an Excel set to a European locale is separated by SEMICOLONS,
 *     and was refused whole for "having no name column"
 *   "CSV (Comma delimited)" on Windows is Windows-1252, not UTF-8 — every
 *     accented name arrived with � in it, and was saved that way
 *   an .xlsx — what Save does by default — was not a file at all
 *
 * Rows keep the number they have IN THE SHEET, because "row 15" is something
 * the person will go and look for.
 */
final class Tabular
{
    /**
     * @return array{kind: 'xlsx'|'csv', header: array<int, string>, rows: array<int, array<int, string>>}
     */
    public static function read(string $bytes, int $maxRows): array
    {
        if (Zip::looksLikeOne($bytes)) {
            if (! Zip::available()) {
                throw DomainException::unprocessable(
                    'This server cannot open Excel files. Save the sheet as CSV and upload that.',
                    'IMPORT_XLSX_UNAVAILABLE',
                );
            }

            try {
                // The sheet a template is filled in on; else whichever comes first.
                $grid = XlsxReader::rows($bytes, 'Products', $maxRows + 1);
            } catch (RuntimeException $e) {
                throw DomainException::unprocessable($e->getMessage(), 'IMPORT_UNREADABLE');
            }

            return ['kind' => 'xlsx'] + self::split($grid);
        }

        // The old binary format, by its signature. Named, because "not a CSV"
        // tells nobody what to do about it.
        if (strncmp($bytes, "\xD0\xCF\x11\xE0", 4) === 0) {
            throw DomainException::unprocessable(
                'This is an old Excel file (.xls). Save it as Excel Workbook (.xlsx) or CSV and upload that.',
                'IMPORT_XLS_UNSUPPORTED',
            );
        }

        $text = self::utf8($bytes);

        // A picture, a PDF, a Word document renamed .csv: not text at all.
        if (str_contains($text, "\0")) {
            throw DomainException::unprocessable(
                'This file is not a spreadsheet. Upload an Excel workbook (.xlsx) or a CSV.',
                'IMPORT_UNREADABLE',
            );
        }

        return ['kind' => 'csv'] + self::split(self::csv($text));
    }

    /**
     * The first row that has anything in it is the header; rows with nothing
     * in them are not rows.
     *
     * @param  array<int, array<int, string>>  $grid
     * @return array{header: array<int, string>, rows: array<int, array<int, string>>}
     */
    private static function split(array $grid): array
    {
        $header = null;
        $rows = [];

        foreach ($grid as $number => $cells) {
            $cells = array_map(fn ($c): string => trim((string) $c), $cells);
            if (implode('', $cells) === '') {
                continue;
            }

            if ($header === null) {
                $header = $cells;

                continue;
            }

            $rows[$number] = $cells;
        }

        return ['header' => $header ?? [], 'rows' => $rows];
    }

    /** Whatever it was saved as, as UTF-8. */
    private static function utf8(string $bytes): string
    {
        if (strncmp($bytes, "\xEF\xBB\xBF", 3) === 0) {
            return substr($bytes, 3);
        }
        // "Unicode Text" from Excel: UTF-16, tab-separated.
        if (strncmp($bytes, "\xFF\xFE", 2) === 0) {
            return mb_convert_encoding(substr($bytes, 2), 'UTF-8', 'UTF-16LE');
        }
        if (strncmp($bytes, "\xFE\xFF", 2) === 0) {
            return mb_convert_encoding(substr($bytes, 2), 'UTF-8', 'UTF-16BE');
        }

        return mb_check_encoding($bytes, 'UTF-8')
            ? $bytes
            : mb_convert_encoding($bytes, 'UTF-8', 'Windows-1252');
    }

    /**
     * @return array<int, array<int, string>> record number (1-based, the row Excel shows) => cells
     */
    private static function csv(string $text): array
    {
        $separator = self::separator($text);

        $stream = fopen('php://temp', 'r+');
        if ($stream === false) {
            throw new RuntimeException('Could not read the file.');
        }
        fwrite($stream, $text);
        rewind($stream);

        // fgetcsv, not a split on newlines: a quoted cell may hold one.
        $grid = [];
        $n = 0;
        while (($cells = fgetcsv($stream, null, $separator, '"', '')) !== false) {
            $n++;
            $grid[$n] = array_map(fn ($c): string => (string) $c, $cells);
        }
        fclose($stream);

        return $grid;
    }

    /**
     * Comma, semicolon or tab — whichever the HEADER is cut by.
     *
     * Counted outside quotes on the first line only: a description full of
     * commas lower down says nothing about how the file is separated.
     */
    private static function separator(string $text): string
    {
        $first = strtok($text, "\r\n") ?: '';
        $bare = preg_replace('/"[^"]*"/', '', $first) ?? $first;

        $counts = [',' => substr_count($bare, ','), ';' => substr_count($bare, ';'), "\t" => substr_count($bare, "\t")];
        arsort($counts);

        return (string) array_key_first($counts);
    }
}
