<?php

namespace App\Support;

use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Small CSV download helper. Rows are materialised by the caller BEFORE this
 * is invoked — the streamed callback runs during response-send, by which point
 * the tenant context (and its global scope) may already be torn down, so we
 * never run a scoped query from inside it.
 */
class CsvExport
{
    /**
     * A cell a spreadsheet will read as TEXT.
     *
     * Excel and Sheets run a cell that starts `=`, `+`, `-` or `@` as a
     * formula. Most of what is exported here was typed by somebody — a
     * customer's name, a note, a business's name — and the platform's own
     * ledger export puts names chosen by shop owners in front of the
     * platform's accountant. `=HYPERLINK("http://…","Refund")` as a business
     * name is a link in their spreadsheet.
     *
     * A leading apostrophe is how a spreadsheet is told "this is text". A
     * number is left alone: "-500" is a refund, not a formula, and has to
     * stay a number in the column it is summed in.
     */
    public static function text(mixed $cell): mixed
    {
        if (! is_string($cell) || $cell === '' || is_numeric($cell)) {
            return $cell;
        }

        return preg_match('/^[=+\-@\t\r]/', $cell) === 1 ? "'".$cell : $cell;
    }

    /**
     * @param  array<int, string>  $header
     * @param  array<int, array<int, scalar|null>>  $rows
     */
    public static function stream(string $filename, array $header, array $rows): StreamedResponse
    {
        return response()->streamDownload(function () use ($header, $rows): void {
            $out = fopen('php://output', 'w');
            // UTF-8 BOM so Excel opens Urdu / accented names correctly.
            fwrite($out, "\xEF\xBB\xBF");
            fputcsv($out, $header);
            foreach ($rows as $row) {
                fputcsv($out, array_map(self::text(...), $row));
            }
            fclose($out);
        }, $filename, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Cache-Control' => 'no-store, no-cache',
        ]);
    }
}
