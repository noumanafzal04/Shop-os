<?php

namespace App\Support;

use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Small CSV download helper.
 *
 * The streamed callback runs during response-send, by which point the tenant
 * context (and its global scope) may already be torn down, so no scoped query
 * may run from inside it. So the file is WRITTEN HERE, before the response
 * leaves — into a temporary file that spills to disk past 2 MB — and the
 * callback only hands that file over. The rows may therefore be a generator
 * reading the shelf a page at a time (#GS4): it is read to the end now, while
 * the shop is still known, and memory holds one page of it, not the list.
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
     * @param  iterable<int, array<int, scalar|null>>  $rows
     */
    public static function stream(string $filename, array $header, iterable $rows): StreamedResponse
    {
        $file = fopen('php://temp', 'w+b');
        // UTF-8 BOM so Excel opens Urdu / accented names correctly.
        fwrite($file, "\xEF\xBB\xBF");
        fputcsv($file, $header);
        foreach ($rows as $row) {
            fputcsv($file, array_map(self::text(...), $row));
        }
        rewind($file);

        return response()->streamDownload(function () use ($file): void {
            fpassthru($file);
            fclose($file);
        }, $filename, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Cache-Control' => 'no-store, no-cache',
        ]);
    }
}
