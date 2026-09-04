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
                fputcsv($out, $row);
            }
            fclose($out);
        }, $filename, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Cache-Control' => 'no-store, no-cache',
        ]);
    }
}
