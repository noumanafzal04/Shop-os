<?php

namespace App\Support;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Where the photo of a bill lives, and who may look at it.
 *
 * These used to go to the `public` disk, alongside product photos and shop
 * logos. Those belong there — they are meant to be seen by strangers. A
 * receipt is not: it is a supplier's name, an amount, an account number and a
 * shop's letterhead, and `public` means served by the web server with no token
 * and no tenant check at all. Anyone holding the URL — anyone who was ever sent
 * one, anyone reading a browser history or a proxy log — could read another
 * business's bills, and nothing in the application would ever see the request.
 *
 * The random filename was doing all the work, which is not a permission model.
 *
 * They now live on the private disk and are handed out by an endpoint that runs
 * the same tenant scope and the same permission as the row they hang off.
 *
 * Legacy rows are still read from `public`, because files uploaded before this
 * change are physically there. New writes never go back.
 */
class ReceiptFiles
{
    /** The private disk. Not web-served; only reachable through the API. */
    public const DISK = 'local';

    public static function store(UploadedFile $file, string $tenantId): string
    {
        return $file->store("receipts/{$tenantId}", self::DISK);
    }

    /**
     * Delete wherever it actually is. A row written before this change points
     * at `public`, and detaching it must not leave the file on disk.
     */
    public static function delete(?string $path): void
    {
        if ($path === null || $path === '') {
            return;
        }

        foreach ([self::DISK, 'public'] as $disk) {
            if (Storage::disk($disk)->exists($path)) {
                Storage::disk($disk)->delete($path);

                return;
            }
        }
    }

    /** Which disk this path is on, or null when the file is gone. */
    public static function diskFor(string $path): ?string
    {
        foreach ([self::DISK, 'public'] as $disk) {
            if (Storage::disk($disk)->exists($path)) {
                return $disk;
            }
        }

        return null;
    }

    /**
     * Stream it inline so a receipt opens in a tab rather than downloading —
     * checking a bill against a row is a glance, not a filing operation.
     */
    public static function response(string $path): ?StreamedResponse
    {
        $disk = self::diskFor($path);

        if ($disk === null) {
            return null;
        }

        return Storage::disk($disk)->response($path, basename($path), [
            'Content-Disposition' => 'inline; filename="'.basename($path).'"',
        ]);
    }
}
