<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Http\Requests\Catalog\UploadProductImagesRequest;
use App\Models\Product;
use App\Models\ProductImage;
use App\Exceptions\DomainException;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class ProductImageController extends Controller
{
    /** Hard cap so a single product can't accumulate unbounded images. */
    private const MAX_IMAGES = 8;

    /**
     * Upload one or more images for a product. Appended after existing ones.
     * {product} is tenant-scoped via the BelongsToTenant global scope.
     */
    public function store(UploadProductImagesRequest $request, Product $product, \App\Support\TenantContext $context): JsonResponse
    {
        // Image module gate: a walk-in-only shop that keeps images off can't
        // upload. Selling online always allows them (see Tenant::imagesEnabled).
        if (! $context->get()?->imagesEnabled()) {
            throw DomainException::forbidden(
                'Product images are turned off for this shop.',
                'IMAGES_DISABLED',
            );
        }

        $files = $request->file('images');
        $existing = $product->images()->count();

        if ($existing + count($files) > self::MAX_IMAGES) {
            throw DomainException::unprocessable(
                'A product can have at most '.self::MAX_IMAGES.' images.',
                'IMAGE_LIMIT_REACHED',
            );
        }

        DB::transaction(function () use ($product, $files, $existing): void {
            $sort = $existing;
            foreach ($files as $file) {
                $path = $file->store("products/{$product->tenant_id}/{$product->id}", 'public');
                $product->images()->create([
                    'tenant_id' => $product->tenant_id,
                    'path' => $path,
                    'sort_order' => $sort++,
                ]);
            }
        });

        return ApiResponse::ok(
            $product->load('images'),
            'Images uploaded',
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
        $image->delete();

        return ApiResponse::ok($product->load('images'), 'Image removed');
    }
}
