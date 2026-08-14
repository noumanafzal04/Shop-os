<?php

namespace App\Console\Commands;

use App\Models\ProductImage;
use App\Support\Thumbnail;
use Illuminate\Console\Command;

/**
 * Make thumbnails for photos uploaded before thumbnails existed.
 *
 * New uploads get one at upload time. Everything already on the disk does not,
 * and those are exactly the shops that have been running longest and have the
 * biggest menus — the ones a POS grid hurts most.
 *
 * Safe to run repeatedly and safe to interrupt: it only looks at rows with no
 * thumbnail yet, and each row is committed as it is done. A shop's images can
 * be a few thousand files, so it deliberately does not try to be fast — it
 * tries to be resumable.
 */
class BackfillThumbnails extends Command
{
    protected $signature = 'images:thumbnails
        {--limit=0 : Stop after this many, for a first run on a busy server}
        {--redo : Remake thumbnails that already exist}';

    protected $description = 'Generate missing product image thumbnails';

    public function handle(): int
    {
        $query = ProductImage::withoutTenancy()
            ->when(! $this->option('redo'), fn ($q) => $q->whereNull('thumb_path'))
            ->orderBy('created_at');

        $total = (clone $query)->count();
        if ($total === 0) {
            $this->info('Every product image already has a thumbnail.');

            return self::SUCCESS;
        }

        $limit = (int) $this->option('limit');
        $bar = $this->output->createProgressBar($limit > 0 ? min($limit, $total) : $total);

        $made = 0;
        $skipped = 0;

        $query->chunkById(200, function ($images) use (&$made, &$skipped, $bar, $limit): bool {
            foreach ($images as $image) {
                $path = Thumbnail::make($image->path);

                if ($path === null) {
                    // A corrupt file, a format this PHP cannot read, or an
                    // original that is no longer on disk. Left alone rather
                    // than failed: the shop keeps its photo and the grid falls
                    // back to the original, which is what it did yesterday.
                    $skipped++;
                } else {
                    $image->forceFill(['thumb_path' => $path])->saveQuietly();
                    $made++;
                }

                $bar->advance();

                if ($limit > 0 && $made + $skipped >= $limit) {
                    return false;
                }
            }

            return true;
        });

        $bar->finish();
        $this->newLine(2);
        $this->info("Made {$made} thumbnail(s).");

        if ($skipped > 0) {
            $this->warn("{$skipped} could not be read and were left as they are.");
        }

        return self::SUCCESS;
    }
}
