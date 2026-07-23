<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Models\GalleryImage;
use App\Support\ApiResponse;
use App\Support\Permissions;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * Tenant portfolio/gallery — showcase photos on the storefront. Same shape as
 * product images but tenant-scoped and standalone.
 */
class GalleryController extends Controller
{
    private const MAX_IMAGES = 30;

    public function __construct(private readonly TenantContext $context) {}

    public function index(): JsonResponse
    {
        return ApiResponse::ok(
            GalleryImage::query()->orderBy('sort_order')->get(),
        );
    }

    public function store(Request $request): JsonResponse
    {
        if (! $request->user()->hasPermission(Permissions::SETTINGS_MANAGE)) {
            throw DomainException::forbidden('You cannot manage the gallery.');
        }

        $request->validate([
            'images' => ['required', 'array', 'min:1', 'max:10'],
            'images.*' => ['image', 'mimes:jpg,jpeg,png,webp', 'max:4096'],
        ]);

        $tenantId = $this->context->id();
        $existing = GalleryImage::query()->count();
        if ($existing + count($request->file('images')) > self::MAX_IMAGES) {
            throw DomainException::unprocessable('Gallery is limited to '.self::MAX_IMAGES.' photos.', 'GALLERY_LIMIT');
        }

        $sort = $existing;
        foreach ($request->file('images') as $file) {
            GalleryImage::query()->create([
                'tenant_id' => $tenantId,
                'path' => $file->store("gallery/{$tenantId}", 'public'),
                'sort_order' => $sort++,
            ]);
        }

        return ApiResponse::ok(GalleryImage::query()->orderBy('sort_order')->get(), 'Photos added');
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        if (! $request->user()->hasPermission(Permissions::SETTINGS_MANAGE)) {
            throw DomainException::forbidden('You cannot manage the gallery.');
        }

        $image = GalleryImage::query()->findOrFail($id);
        Storage::disk('public')->delete($image->path);
        $image->delete();

        return ApiResponse::noContent('Photo removed');
    }
}
