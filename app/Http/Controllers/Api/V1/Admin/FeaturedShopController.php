<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * FEATURING A SHOP — the paid row at the top of the app's home.
 *
 * Set by whoever sells the ad space (the banners permission: it is the same
 * trade, a paid place on the customer's screen), with the day it ends. It
 * ends on its own; `until: null` ends it now. Featuring buys position, never
 * visibility: a shop customers could not order from is not shown, paid or not.
 */
class FeaturedShopController extends Controller
{
    public function update(Request $request, string $tenant): JsonResponse
    {
        $data = $request->validate([
            'until' => ['present', 'nullable', 'date', 'after:now'],
            'rank' => ['sometimes', 'integer', 'between:1,999'],
        ], [
            'until.after' => 'The featured days must end in the future — or clear the date to stop featuring this shop.',
        ]);

        $shop = Tenant::query()->findOrFail($tenant);
        $shop->forceFill([
            'featured_until' => $data['until'] ?? null,
            'featured_rank' => $data['rank'] ?? $shop->featured_rank,
        ])->save();

        return ApiResponse::ok(
            ['featured_until' => $shop->featured_until?->toIso8601String(), 'featured_rank' => $shop->featured_rank, 'is_featured' => $shop->isFeatured()],
            $shop->isFeatured() ? "{$shop->business_name} is featured until {$shop->featured_until->toFormattedDateString()}" : "{$shop->business_name} is no longer featured",
        );
    }
}
