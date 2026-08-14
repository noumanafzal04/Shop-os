<?php

namespace App\Support;

use Illuminate\Support\Facades\Storage;

/**
 * A small square version of a product photo.
 *
 * ── Why this exists at all ──────────────────────────────────────────────
 *
 * A photo taken on a phone is 2–4 MB. A restaurant's POS renders its menu as a
 * grid of images, so a 300-item menu was asking a counter tablet to download
 * roughly a gigabyte — over a shop's connection, before the first order of the
 * day. That is already the slowest thing about the online till; offline it is
 * simply impossible, because a device cannot hold it.
 *
 * At 200×200 WebP the same menu is about 3 MB and fits with room to spare.
 *
 * ── Plain GD, not a library ─────────────────────────────────────────────
 *
 * GD ships with the PHP the droplet already runs and is in CI's extension list.
 * An image library would be a dependency, a version to track and a supply-chain
 * surface, in exchange for resizing one square — which is forty lines.
 *
 * ── Failure is never fatal ──────────────────────────────────────────────
 *
 * A corrupt upload, an unsupported format, a server built without WebP: none of
 * those may cost a shopkeeper their photo. Every path returns null and the
 * original is kept, so the worst case is the grid loading full images exactly
 * as it does today.
 */
class Thumbnail
{
    /** Square edge, in pixels. Fits a POS grid tile at 2× on a retina tablet. */
    public const SIZE = 200;

    /** WebP quality. 78 is where the artefacts stop being visible on a tile. */
    private const QUALITY = 78;

    /**
     * Make a thumbnail for a stored image and return its path, or null.
     *
     * `$path` and the returned path are both relative to the `public` disk.
     */
    public static function make(string $path, string $disk = 'public'): ?string
    {
        if (! function_exists('imagecreatefromstring') || ! function_exists('imagewebp')) {
            return null;
        }

        $storage = Storage::disk($disk);
        if (! $storage->exists($path)) {
            return null;
        }

        $source = @imagecreatefromstring((string) $storage->get($path));
        if ($source === false) {
            // Not an image this build of GD understands. Keep the original.
            return null;
        }

        try {
            $thumb = self::square($source);
            if ($thumb === null) {
                return null;
            }

            ob_start();
            $ok = imagewebp($thumb, null, self::QUALITY);
            $bytes = (string) ob_get_clean();
            imagedestroy($thumb);

            if (! $ok || $bytes === '') {
                return null;
            }

            $thumbPath = self::pathFor($path);
            $storage->put($thumbPath, $bytes);

            return $thumbPath;
        } finally {
            imagedestroy($source);
        }
    }

    /**
     * Centre-crop to a square, then scale down.
     *
     * Cropped rather than letterboxed because a POS grid is squares: padding
     * every tile to fit a 4:3 photo wastes a third of a screen a cashier is
     * scanning at arm's length.
     *
     * @param  \GdImage  $source
     */
    private static function square($source): mixed
    {
        $width = imagesx($source);
        $height = imagesy($source);
        if ($width < 1 || $height < 1) {
            return null;
        }

        $edge = min($width, $height);
        $x = (int) (($width - $edge) / 2);
        $y = (int) (($height - $edge) / 2);

        $thumb = imagecreatetruecolor(self::SIZE, self::SIZE);
        if ($thumb === false) {
            return null;
        }

        // Keep transparency: a PNG logo on a transparent background would
        // otherwise get a black square behind it.
        imagealphablending($thumb, false);
        imagesavealpha($thumb, true);

        imagecopyresampled($thumb, $source, 0, 0, $x, $y, self::SIZE, self::SIZE, $edge, $edge);

        return $thumb;
    }

    /**
     * Where a thumbnail lives, given its original.
     *
     * Derived rather than stored so the two can never point at different files,
     * and suffixed rather than put in a sibling folder so deleting a product's
     * image directory takes its thumbnails with it.
     */
    public static function pathFor(string $path): string
    {
        $withoutExtension = preg_replace('/\.[^.\/]+$/', '', $path) ?? $path;

        return $withoutExtension.'_thumb.webp';
    }
}
