<?php

namespace App\Http\Controllers\Api\V1\Marketplace;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class FavoriteController extends Controller
{
    /**
     * The customer's favorite shops (only ones still marketplace-visible).
     */
    public function index(Request $request): JsonResponse
    {
        $tenantIds = DB::table('customer_favorites')
            ->where('user_id', $request->user()->id)
            ->pluck('tenant_id');

        $shops = Tenant::query()
            ->marketplaceVisible()
            ->with('city:id,name')
            ->whereIn('id', $tenantIds)
            ->get()
            ->map(fn (Tenant $t) => [
                'slug' => $t->slug,
                'business_name' => $t->business_name,
                'business_type' => $t->business_type,
                'business_category' => $t->business_category,
                'city' => $t->city?->only(['id', 'name']),
                'logo_path' => $t->logo_path,
            ]);

        return ApiResponse::ok($shops);
    }

    /**
     * Toggle a shop as favorite (by slug).
     */
    public function toggle(Request $request, string $slug): JsonResponse
    {
        $tenant = Tenant::query()->marketplaceVisible()->where('slug', $slug)->firstOrFail();

        $existing = DB::table('customer_favorites')
            ->where('user_id', $request->user()->id)
            ->where('tenant_id', $tenant->id);

        if ($existing->exists()) {
            $existing->delete();

            return ApiResponse::ok(['favorited' => false], 'Removed from favorites');
        }

        DB::table('customer_favorites')->insert([
            'id' => (string) Str::uuid7(),
            'user_id' => $request->user()->id,
            'tenant_id' => $tenant->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return ApiResponse::ok(['favorited' => true], 'Added to favorites');
    }
}
