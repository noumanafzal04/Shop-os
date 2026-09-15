<?php

namespace Database\Seeders\Concerns;

use Illuminate\Support\Facades\Storage;

/**
 * PICTURES FOR A DEMO WORLD, drawn rather than downloaded.
 *
 * ── Why generated ───────────────────────────────────────────────────────
 *
 * A marketplace with no photographs reads as a marketplace that failed to
 * load. Real photographs are not an option here for two reasons that are both
 * final: the brands a demo wants are other people's, and an image pack in the
 * repository is megabytes nobody can review.
 *
 * So: GD, a coloured ground, and the name. It does not pretend to be a
 * photograph — it is obviously a placeholder — and that is the honest thing
 * for a shop that has not uploaded one.
 *
 * ── No font file, on purpose ────────────────────────────────────────────
 *
 * `imagettftext` needs a TTF, and this runs on a droplet whose fonts are not
 * ours to assume. GD's built-in font tops out at roughly 9x15 pixels, which is
 * unreadable on a 512px tile — so the text is drawn small and the whole canvas
 * is scaled up. Blocky by construction, legible at every size, and dependent
 * on nothing.
 */
trait MakesPlaceholderArt
{
    /**
     * A square logo: a solid ground and the shop's initials.
     *
     * Returns the storage path, which is what `tenants.logo_path` holds.
     */
    protected function makeLogo(string $id, string $name, array $rgb): string
    {
        $path = "logos/demo/{$id}.png";

        if (Storage::disk('public')->exists($path)) {
            return $path;
        }

        Storage::disk('public')->put($path, $this->square(512, $rgb, $this->initials($name)));

        return $path;
    }

    /** A wide product picture. Returns the storage path. */
    protected function makeProductImage(string $id, string $label, array $rgb): string
    {
        $path = "products/demo/{$id}.png";

        if (Storage::disk('public')->exists($path)) {
            return $path;
        }

        Storage::disk('public')->put($path, $this->wide(800, 600, $rgb, $label));

        return $path;
    }

    /**
     * Up to two letters, skipping the words that are not a name.
     *
     * "The Pizza Company" is P, not T — a leading article carries none of the
     * identity, and two shops starting with one would collide on that letter.
     */
    protected function initials(string $name): string
    {
        $skip = ['the', 'a', 'an', 'and', '&', 'of'];
        $words = array_values(array_filter(
            preg_split('/[\s\-]+/u', $name) ?: [],
            fn ($w) => $w !== '' && ! in_array(mb_strtolower($w), $skip, true),
        ));

        if ($words === []) {
            return '?';
        }

        $first = mb_strtoupper(mb_substr($words[0], 0, 1));

        return count($words) > 1
            ? $first.mb_strtoupper(mb_substr($words[1], 0, 1))
            : $first;
    }

    // ---------------------------------------------------------------

    /** @param array{0:int,1:int,2:int} $rgb */
    private function square(int $size, array $rgb, string $text): string
    {
        // Drawn small, scaled up. The built-in font cannot be sized, so this is
        // the only way to a letter that fills a tile.
        $small = 64;
        $im = imagecreatetruecolor($small, $small);
        imagefilledrectangle($im, 0, 0, $small, $small, imagecolorallocate($im, ...$rgb));

        // A lighter wedge across one corner, so a wall of these has depth
        // rather than reading as flat swatches.
        imagefilledpolygon(
            $im,
            [0, $small, $small, (int) ($small * 0.62), $small, $small],
            imagecolorallocatealpha($im, 255, 255, 255, 105),
        );

        $fg = imagecolorallocate($im, 255, 255, 255);
        // Font 5 is 9x15. Centred by its own measured size rather than by a
        // guess, or a one-letter logo sits off to the left.
        $w = imagefontwidth(5) * mb_strlen($text);
        imagestring($im, 5, (int) (($small - $w) / 2), (int) (($small - imagefontheight(5)) / 2), $text, $fg);

        $out = imagescale($im, $size, $size, IMG_NEAREST_NEIGHBOUR);
        imagedestroy($im);

        return $this->png($out);
    }

    /** @param array{0:int,1:int,2:int} $rgb */
    private function wide(int $w, int $h, array $rgb, string $label): string
    {
        $im = imagecreatetruecolor($w, $h);
        imagefilledrectangle($im, 0, 0, $w, $h, imagecolorallocate($im, ...$rgb));
        imagefilledpolygon(
            $im,
            [0, $h, $w, (int) ($h * 0.58), $w, $h],
            imagecolorallocatealpha($im, 255, 255, 255, 105),
        );

        $fg = imagecolorallocate($im, 255, 255, 255);
        // Two lines rather than one truncated one: a product name is often
        // three words and "Chicken Cheese Sandw" helps nobody.
        foreach ($this->wrap($label, 26) as $i => $line) {
            imagestring($im, 5, 28, 28 + ($i * (imagefontheight(5) + 6)), $line, $fg);
        }

        return $this->png($im);
    }

    /** @return list<string> */
    private function wrap(string $text, int $width): array
    {
        return array_slice(explode("\n", wordwrap($text, $width, "\n", true)), 0, 3);
    }

    /** @param \GdImage $im */
    private function png($im): string
    {
        ob_start();
        imagepng($im);
        imagedestroy($im);

        return (string) ob_get_clean();
    }
}
