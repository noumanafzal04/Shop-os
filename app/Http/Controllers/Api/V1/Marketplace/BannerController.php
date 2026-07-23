<?php

namespace App\Http\Controllers\Api\V1\Marketplace;

use App\Http\Controllers\Controller;
use App\Models\Banner;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public promo-banner feed for the mobile/marketplace home. Returns live
 * banners with a resolved deep-link target so a tap opens the advertiser's
 * shop / a product / a URL.
 */
class BannerController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $banners = Banner::query()
            ->live()
            ->with('advertiser:id,slug,business_name')
            ->where('placement', $request->query('placement', 'home'))
            ->orderBy('sort_order')
            ->get();

        // Count impressions for what we served.
        if ($banners->isNotEmpty()) {
            Banner::query()->whereIn('id', $banners->pluck('id'))->increment('impression_count');
        }

        return ApiResponse::ok($banners->map(fn (Banner $b) => $this->serialize($b))->all());
    }

    public function click(string $id): JsonResponse
    {
        /** @var Banner $banner */
        $banner = Banner::query()->live()->with('advertiser:id,slug')->findOrFail($id);
        $banner->increment('click_count');

        return ApiResponse::ok(['target' => $this->target($banner)], 'ok');
    }

    private function serialize(Banner $b): array
    {
        return [
            'id' => $b->id,
            'title' => $b->title,
            'image_url' => $b->image_url,
            'target' => $this->target($b),
        ];
    }

    /** Client-agnostic deep-link descriptor. */
    private function target(Banner $b): array
    {
        return match ($b->target_type) {
            'shop' => ['type' => 'shop', 'shop_slug' => $b->advertiser?->slug],
            'product' => ['type' => 'product', 'product_id' => $b->target_product_id, 'shop_slug' => $b->advertiser?->slug],
            'url' => ['type' => 'url', 'url' => $b->target_url],
            default => ['type' => 'none'],
        };
    }
}
