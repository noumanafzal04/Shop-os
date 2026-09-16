<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Catalog\UploadProductImagesRequest;
use App\Models\Product;
use App\Models\ProductImage;
use App\Support\ApiResponse;
use App\Support\TenantContext;
use App\Support\Thumbnail;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * ONE PRODUCT, ONE PICTURE.
 *
 * ── Why this replaces rather than appends ───────────────────────────────
 *
 * It used to take up to eight and add each one after the last, and the
 * consequence was reported plainly: "maine aik KFC main aik image upload ki
 * hai … currently zeyda add ho rahi". Somebody correcting a bad photo got a
 * SECOND photo, and the wrong one stayed first — which is the one every
 * surface actually draws.
 *
 * Because nothing anywhere shows more than one. The marketplace card, the
 * aisle, the basket, the offline till's grid and the shop page all read
 * `images[0]`; the extras were storage, quota and a list to scroll on a form.
 * A gallery that only ever shows its first entry is not a gallery — it is a
 * cover with clutter behind it.
 *
 * So: one file, and uploading again REPLACES what is there — the old row and
 * the old file, which is also the "unable to delete previous image" half of
 * the same report. The delete endpoint stays for taking the picture off
 * entirely.
 *
 * The shop's own GALLERY is a different thing and still holds thirty — see
 * `GalleryController`. That one is a portfolio and is displayed as one.
 */
class ProductImageController extends Controller
{
    /**
     * Upload the product's picture, replacing any it already had.
     *
     * {product} is tenant-scoped via the BelongsToTenant global scope.
     */
    public function store(UploadProductImagesRequest $request, Product $product, TenantContext $context): JsonResponse
    {
        // Image module gate: a walk-in-only shop that keeps images off can't
        // upload. Selling online always allows them (see Tenant::imagesEnabled).
        if (! $context->get()?->imagesEnabled()) {
            throw DomainException::forbidden(
                'Product images are turned off for this shop.',
                'IMAGES_DISABLED',
            );
        }

        $file = $request->file('images')[0];

        /**
         * THE OLD ONES GO, FILES AND ALL.
         *
         * Collected before the transaction and deleted from the disk after it
         * commits: `Storage::delete` is not transactional, so doing it inside
         * would destroy the file and then, on a rollback, leave a row pointing
         * at nothing. A row with no file draws a broken image for ever; a file
         * with no row is a few kilobytes nobody sees.
         *
         * `images()` is every one a product accumulated under the old rule, not
         * just the first — a product that already has five is cleaned up the
         * first time anybody touches its picture.
         */
        $stale = $product->images()->get();

        DB::transaction(function () use ($product, $file, $stale): void {
            $product->images()->whereIn('id', $stale->pluck('id'))->delete();

            $path = $file->store("products/{$product->tenant_id}/{$product->id}", 'public');
            $product->images()->create([
                'tenant_id' => $product->tenant_id,
                'path' => $path,
                // A small square made at upload time, because the alternative
                // is a restaurant's POS grid downloading a gigabyte of phone
                // photos before the first order of the day. Null when it could
                // not be made — a corrupt file, an unsupported format, a PHP
                // without WebP — and the grid then falls back to the original
                // exactly as before.
                'thumb_path' => Thumbnail::make($path),
                'sort_order' => 0,
            ]);
        });

        foreach ($stale as $old) {
            Storage::disk('public')->delete($old->path);
            if ($old->thumb_path) {
                // The thumbnail is a SEPARATE file. Deleting only the original
                // left a square behind per replacement, which is the quota
                // nobody notices until it is full.
                Storage::disk('public')->delete($old->thumb_path);
            }
        }

        return ApiResponse::ok(
            $product->load('images'),
            $stale->isEmpty() ? 'Photo added' : 'Photo replaced',
        );
    }

    /**
     * Delete a single image. Both bindings are tenant-scoped; we also verify
     * the image belongs to the given product to reject cross-product IDs.
     */
    public function destroy(Product $product, ProductImage $image): JsonResponse
    {
        if ($image->product_id !== $product->id) {
            throw DomainException::unprocessable('Image not found on this product.', 'IMAGE_NOT_FOUND');
        }

        Storage::disk('public')->delete($image->path);
        if ($image->thumb_path) {
            // The square made at upload time is its own file. Removing only the
            // original left one behind every time a picture was deleted.
            Storage::disk('public')->delete($image->thumb_path);
        }
        $image->delete();

        return ApiResponse::ok($product->load('images'), 'Image removed');
    }
}
