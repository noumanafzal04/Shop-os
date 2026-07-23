<?php

namespace App\Http\Controllers\Api\V1\Marketplace;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\Tenant;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * PUBLIC marketplace — no auth required. Serialization here is deliberately
 * separate from tenant-side resources: cost, stock counts, and internal
 * flags NEVER leak to customers.
 */
class MarketplaceController extends Controller
{
    /**
     * GPS → market: resolve the caller's coordinates to the nearest active
     * city, so the app never needs a manual city picker.
     */
    public function locate(Request $request): JsonResponse
    {
        $data = $request->validate([
            'lat' => ['required', 'numeric', 'between:-90,90'],
            'lng' => ['required', 'numeric', 'between:-180,180'],
        ]);

        $city = \App\Models\City::query()
            ->where('is_active', true)
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->orderByRaw(\App\Support\Geo::sqlDistanceKm((float) $data['lat'], (float) $data['lng']))
            ->first();

        if ($city === null) {
            return ApiResponse::ok(['city' => null, 'in_service_area' => false]);
        }

        $distance = \App\Support\Geo::distanceKm(
            (float) $data['lat'], (float) $data['lng'],
            (float) $city->latitude, (float) $city->longitude,
        );

        return ApiResponse::ok([
            'city' => $city->only(['id', 'name', 'latitude', 'longitude']),
            'distance_km' => $distance,
            // Beyond ~60 km of any city centre we're honest: not served yet.
            'in_service_area' => $distance <= 60,
        ]);
    }

    /**
     * Shop discovery. With lat/lng: nearest-first with distance_km on every
     * shop (location-based, foodpanda-style). Without: city/name browse.
     */
    public function shops(Request $request): JsonResponse
    {
        $lat = $request->query('lat') !== null ? (float) $request->query('lat') : null;
        $lng = $request->query('lng') !== null ? (float) $request->query('lng') : null;
        $near = $lat !== null && $lng !== null;

        $query = Tenant::query()
            ->marketplaceVisible()
            ->with('city:id,name')
            ->withAvg(['reviews as rating_avg' => fn ($q) => $q->where('is_published', true)], 'rating')
            ->withCount(['reviews as reviews_count' => fn ($q) => $q->where('is_published', true)])
            ->when($request->query('city_id'), fn ($q, $cityId) => $q->where('city_id', $cityId))
            ->when($request->query('business_type'), fn ($q, $type) => $q->where('business_type', $type))
            ->when($request->query('search'), function ($q, $search): void {
                $q->where(function ($q) use ($search): void {
                    $q->where('business_name', 'like', "%{$search}%")
                        ->orWhere('business_category', 'like', "%{$search}%");
                });
            });

        if ($near) {
            $expr = \App\Support\Geo::sqlDistanceKm($lat, $lng);
            $query->selectRaw("tenants.*, CASE WHEN latitude IS NULL OR longitude IS NULL THEN NULL ELSE {$expr} END as distance_km")
                // Un-pinned shops sink to the end instead of disappearing.
                ->orderByRaw('distance_km IS NULL, distance_km')
                ->when($request->query('radius'), fn ($q, $r) => $q->havingRaw('distance_km IS NOT NULL AND distance_km <= ?', [min((float) $r, 100)]));
        } else {
            $query->orderBy('business_name');
        }

        $shops = $query
            ->paginate(min((int) $request->query('per_page', 20), 100))
            ->through(fn (Tenant $t) => $this->publicShop($t) + [
                'distance_km' => isset($t->distance_km) && $t->distance_km !== null ? round((float) $t->distance_km, 2) : null,
            ]);

        return ApiResponse::paginated($shops);
    }

    public function shop(Request $request, string $slug): JsonResponse
    {
        $tenant = Tenant::query()
            ->marketplaceVisible()
            ->with('city:id,name')
            ->withAvg(['reviews as rating_avg' => fn ($q) => $q->where('is_published', true)], 'rating')
            ->withCount(['reviews as reviews_count' => fn ($q) => $q->where('is_published', true)])
            ->where('slug', $slug)
            ->firstOrFail();

        $payload = $this->publicShop($tenant, detailed: true);

        // Caller sent their pin → answer "how far, and do you deliver to me?"
        $lat = $request->query('lat') !== null ? (float) $request->query('lat') : null;
        $lng = $request->query('lng') !== null ? (float) $request->query('lng') : null;
        if ($lat !== null && $lng !== null && $tenant->latitude !== null && $tenant->longitude !== null) {
            $distance = \App\Support\Geo::distanceKm($lat, $lng, (float) $tenant->latitude, (float) $tenant->longitude);
            $radius = $tenant->setting('delivery_radius_km');
            $payload['distance_km'] = $distance;
            $payload['delivers_to_me'] = $tenant->deliveryEnabled()
                && ($radius === null || $distance <= (float) $radius);
        }

        return ApiResponse::ok($payload);
    }

    /**
     * A shop's public catalog — active, marketplace-visible items only.
     */
    public function products(Request $request, string $slug): JsonResponse
    {
        $tenant = Tenant::query()
            ->marketplaceVisible()
            ->where('slug', $slug)
            ->firstOrFail();

        $products = Product::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->where('is_active', true)
            ->where('visible_in_marketplace', true)
            ->with([
                'category:id,name', 'images',
                'variants' => fn ($q) => $q->where('is_active', true),
                'modifierGroups' => fn ($q) => $q->with(['options' => fn ($o) => $o->where('is_active', true)]),
            ])
            ->when($request->query('search'), fn ($q, $s) => $q->where(fn ($w) => $w
                ->where('name', 'like', "%{$s}%")
                ->orWhere('brand', 'like', "%{$s}%")
                ->orWhere('generic_name', 'like', "%{$s}%")))
            ->when($request->query('category_id'), fn ($q, $id) => $q->where('category_id', $id))
            ->when($request->query('type'), fn ($q, $type) => $q->where('type', $type))
            ->orderBy('name')
            ->paginate(min((int) $request->query('per_page', 20), 100))
            ->through(fn (Product $p) => $this->publicProduct($p, $tenant->timezone));

        return ApiResponse::paginated($products);
    }

    /**
     * Universal search — one box handles anything typed. Returns grouped
     * results: products (with their shop), shops, and category names.
     * Ranking: exact name > prefix > contains > brand/category match,
     * then rating/popularity. Response shape is engine-agnostic so a
     * search service (Meilisearch) can replace the SQL later untouched.
     */
    public function search(Request $request): JsonResponse
    {
        $data = $request->validate([
            'q' => ['required', 'string', 'min:2', 'max:80'],
            'lat' => ['nullable', 'numeric', 'between:-90,90'],
            'lng' => ['nullable', 'numeric', 'between:-180,180'],
            'city_id' => ['nullable', 'uuid'],
        ]);

        $q = trim($data['q']);
        $like = '%'.str_replace(['%', '_'], ['\%', '\_'], $q).'%';
        $prefix = str_replace(['%', '_'], ['\%', '\_'], $q).'%';
        $near = isset($data['lat'], $data['lng']);

        $visibleTenantIds = Tenant::query()->marketplaceVisible()
            ->when($data['city_id'] ?? null, fn ($qq, $id) => $qq->where('city_id', $id))
            ->pluck('id');

        // ── Products across every visible shop ──────────────────────
        $products = Product::withoutTenancy()
            ->whereIn('tenant_id', $visibleTenantIds)
            ->where('is_active', true)
            ->where('visible_in_marketplace', true)
            ->where(function ($w) use ($like): void {
                $w->where('name', 'like', $like)
                    ->orWhere('brand', 'like', $like)
                    ->orWhere('generic_name', 'like', $like)
                    ->orWhere('description', 'like', $like);
            })
            ->selectRaw(
                'products.*, (CASE
                    WHEN name = ? THEN 100
                    WHEN name LIKE ? THEN 60
                    WHEN name LIKE ? THEN 30
                    WHEN brand LIKE ? THEN 20
                    WHEN generic_name LIKE ? THEN 20
                    ELSE 10 END) as relevance',
                [$q, $prefix, $like, $like, $like],
            )
            ->with('images')
            ->orderByDesc('relevance')
            ->orderBy('name')
            ->limit(20)
            ->get();

        $shopsById = Tenant::query()->whereIn('id', $products->pluck('tenant_id')->unique())
            ->get(['id', 'slug', 'business_name', 'business_type', 'latitude', 'longitude'])
            ->keyBy('id');

        $productResults = $products->map(function (Product $p) use ($shopsById, $near, $data) {
            $shop = $shopsById[$p->tenant_id] ?? null;

            return [
                'id' => $p->id,
                'name' => $p->name,
                'brand' => $p->brand,
                'price' => $p->sellingPrice(),
                'original_price' => $p->sellingPrice() < (float) $p->price ? (float) $p->price : null,
                'image' => $p->images->first()?->url,
                'shop' => $shop?->only(['slug', 'business_name', 'business_type']),
                'distance_km' => $near && $shop?->latitude !== null && $shop?->longitude !== null
                    ? \App\Support\Geo::distanceKm((float) $data['lat'], (float) $data['lng'], (float) $shop->latitude, (float) $shop->longitude)
                    : null,
            ];
        })->values();

        // ── Shops ────────────────────────────────────────────────────
        $shopQuery = Tenant::query()->marketplaceVisible()
            ->when($data['city_id'] ?? null, fn ($qq, $id) => $qq->where('city_id', $id))
            ->with('city:id,name')
            ->withAvg(['reviews as rating_avg' => fn ($r) => $r->where('is_published', true)], 'rating')
            ->withCount(['reviews as reviews_count' => fn ($r) => $r->where('is_published', true)])
            ->where(function ($w) use ($like): void {
                $w->where('business_name', 'like', $like)
                    ->orWhere('business_category', 'like', $like)
                    ->orWhere('business_type', 'like', $like);
            });

        if ($near) {
            $expr = \App\Support\Geo::sqlDistanceKm((float) $data['lat'], (float) $data['lng']);
            $shopQuery->selectRaw("tenants.*, CASE WHEN latitude IS NULL OR longitude IS NULL THEN NULL ELSE {$expr} END as distance_km")
                ->orderByRaw('distance_km IS NULL, distance_km');
        } else {
            $shopQuery->orderByDesc('rating_avg');
        }

        $shopResults = $shopQuery->limit(10)->get()
            ->map(fn (Tenant $t) => $this->publicShop($t) + [
                'distance_km' => isset($t->distance_km) && $t->distance_km !== null ? round((float) $t->distance_km, 2) : null,
            ])->values();

        // ── Category names (with how many shops use them) ────────────
        $categories = \App\Models\Category::withoutTenancy()
            ->whereIn('tenant_id', $visibleTenantIds)
            ->where('is_active', true)
            ->where('name', 'like', $like)
            ->selectRaw('MIN(id) as id, name, COUNT(DISTINCT tenant_id) as shops_count')
            ->groupBy('name')
            ->orderByDesc('shops_count')
            ->limit(8)
            ->get()
            ->map(fn ($c) => ['name' => $c->name, 'shops_count' => (int) $c->shops_count]);

        return ApiResponse::ok([
            'query' => $q,
            'products' => $productResults,
            'shops' => $shopResults,
            'categories' => $categories,
        ]);
    }

    /**
     * The mobile home screen in ONE round trip: banners, nearby shops,
     * top-rated shops, and business-type chips with live counts.
     */
    public function home(Request $request): JsonResponse
    {
        $data = $request->validate([
            'lat' => ['nullable', 'numeric', 'between:-90,90'],
            'lng' => ['nullable', 'numeric', 'between:-180,180'],
            'city_id' => ['nullable', 'uuid'],
        ]);
        $near = isset($data['lat'], $data['lng']);

        $banners = \App\Models\Banner::query()->live()
            ->where('placement', 'home')
            ->with('advertiser:id,slug')
            ->orderBy('sort_order')
            ->get()
            ->each->increment('impression_count')
            ->map(fn ($b) => [
                'id' => $b->id,
                'title' => $b->title,
                'image_url' => $b->image_url,
                'target' => ['type' => $b->target_type] + array_filter([
                    'shop_slug' => $b->target_type === 'shop' ? $b->advertiser?->slug : null,
                    'product_id' => $b->target_product_id,
                    'url' => $b->target_url,
                ]),
            ]);

        $base = fn () => Tenant::query()->marketplaceVisible()
            ->when($data['city_id'] ?? null, fn ($q, $id) => $q->where('city_id', $id))
            ->with('city:id,name')
            ->withAvg(['reviews as rating_avg' => fn ($r) => $r->where('is_published', true)], 'rating')
            ->withCount(['reviews as reviews_count' => fn ($r) => $r->where('is_published', true)]);

        $serialize = fn ($shops) => $shops->map(fn (Tenant $t) => $this->publicShop($t) + [
            'distance_km' => isset($t->distance_km) && $t->distance_km !== null ? round((float) $t->distance_km, 2) : null,
        ])->values();

        $nearby = $base();
        if ($near) {
            $expr = \App\Support\Geo::sqlDistanceKm((float) $data['lat'], (float) $data['lng']);
            $nearby->selectRaw("tenants.*, CASE WHEN latitude IS NULL OR longitude IS NULL THEN NULL ELSE {$expr} END as distance_km")
                ->orderByRaw('distance_km IS NULL, distance_km');
        } else {
            $nearby->orderBy('business_name');
        }

        $topRated = $base()
            ->whereHas('reviews', fn ($r) => $r->where('is_published', true))
            ->orderByDesc('rating_avg')
            ->orderByDesc('reviews_count')
            ->limit(8)
            ->get();

        $types = Tenant::query()->marketplaceVisible()
            ->when($data['city_id'] ?? null, fn ($q, $id) => $q->where('city_id', $id))
            ->selectRaw('business_type, COUNT(*) as shops_count')
            ->groupBy('business_type')
            ->orderByDesc('shops_count')
            ->get()
            ->map(fn ($r) => ['type' => $r->business_type, 'shops_count' => (int) $r->shops_count]);

        // Deals: discounted products across visible shops — the "% off" carousel.
        $visibleIds = Tenant::query()->marketplaceVisible()
            ->when($data['city_id'] ?? null, fn ($q, $id) => $q->where('city_id', $id))
            ->pluck('id');
        $dealShops = Tenant::query()->whereIn('id', $visibleIds)
            ->get(['id', 'slug', 'business_name', 'business_type', 'latitude', 'longitude'])
            ->keyBy('id');
        $deals = Product::withoutTenancy()
            ->whereIn('tenant_id', $visibleIds)
            ->where('is_active', true)
            ->where('visible_in_marketplace', true)
            ->whereNotNull('discount_price')
            ->whereColumn('discount_price', '<', 'price')
            ->with('images')
            ->orderByRaw('(price - discount_price) / price DESC') // deepest cut first
            ->limit(12)
            ->get()
            ->map(function (Product $p) use ($dealShops, $near, $data) {
                $shop = $dealShops[$p->tenant_id] ?? null;

                return [
                    'id' => $p->id,
                    'name' => $p->name,
                    'price' => $p->sellingPrice(),
                    'original_price' => (float) $p->price,
                    'percent_off' => (int) round((1 - $p->sellingPrice() / (float) $p->price) * 100),
                    'image' => $p->images->first()?->url,
                    'shop' => $shop?->only(['slug', 'business_name', 'business_type']),
                    'distance_km' => $near && $shop?->latitude !== null && $shop?->longitude !== null
                        ? \App\Support\Geo::distanceKm((float) $data['lat'], (float) $data['lng'], (float) $shop->latitude, (float) $shop->longitude)
                        : null,
                ];
            })
            ->values();

        return ApiResponse::ok([
            'banners' => $banners,
            'nearby' => $serialize($nearby->limit(12)->get()),
            'top_rated' => $serialize($topRated),
            'deals' => $deals,
            'business_types' => $types,
        ]);
    }

    private function publicShop(Tenant $tenant, bool $detailed = false): array
    {
        $base = [
            'slug' => $tenant->slug,
            'business_name' => $tenant->business_name,
            'business_type' => $tenant->business_type,
            'business_category' => $tenant->business_category,
            'city' => $tenant->city?->only(['id', 'name']),
            'logo_path' => $tenant->logo_path,
            'rating' => $tenant->rating_avg !== null ? round((float) $tenant->rating_avg, 1) : null,
            'reviews_count' => (int) ($tenant->reviews_count ?? 0),
            // On every card, so lists can grey-out closed shops.
            'is_open_now' => $tenant->isOpenNow(),
        ];

        if ($detailed) {
            $base += [
                'address' => $tenant->address,
                // Contact number only for signed-in users — anonymous visitors
                // must register/login to contact the business.
                'phone' => auth('sanctum')->check() ? $tenant->phone : null,
                'phone_requires_login' => ! auth('sanctum')->check(),
                'latitude' => $tenant->latitude,
                'longitude' => $tenant->longitude,
                'business_hours' => $tenant->business_hours,
                'is_open_now' => $tenant->isOpenNow(),
                'categories' => \App\Models\Category::withoutTenancy()
                    ->where('tenant_id', $tenant->id)
                    ->where('is_active', true)
                    ->whereNull('parent_id')
                    ->orderBy('sort_order')
                    ->get(['id', 'name'])
                    ->map(fn ($c) => $c->only(['id', 'name']))
                    ->all(),
                'features' => [
                    'delivery' => $tenant->featureEnabled('delivery'),
                    'reservations' => $tenant->featureEnabled('reservations'),
                    'services' => $tenant->featureEnabled('services'),
                ],
                // Order fulfillment config — clients only show what's supported.
                'fulfillment' => [
                    'pickup' => $tenant->pickupEnabled(),
                    'delivery' => $tenant->deliveryEnabled(),
                ],
                'delivery_fee' => (float) $tenant->delivery_fee,
                'delivery_radius_km' => $tenant->setting('delivery_radius_km') !== null ? (float) $tenant->setting('delivery_radius_km') : null,
                'min_order_amount' => $tenant->setting('min_order_amount') !== null ? (float) $tenant->setting('min_order_amount') : null,
                'free_delivery_threshold' => $tenant->setting('free_delivery_threshold') !== null ? (float) $tenant->setting('free_delivery_threshold') : null,
                'prep_time_minutes' => $tenant->setting('prep_time_minutes') !== null ? (int) $tenant->setting('prep_time_minutes') : null,
                'accepts_orders' => $tenant->sellsOnline(),
                'service_area' => $tenant->setting('service_area'),
                'gallery' => \App\Models\GalleryImage::withoutTenancy()
                    ->where('tenant_id', $tenant->id)
                    ->orderBy('sort_order')
                    ->get()
                    ->map(fn ($g) => $g->url)
                    ->filter()
                    ->values()
                    ->all(),
            ];
        }

        return $base;
    }

    private function publicProduct(Product $product, ?string $timezone = null): array
    {
        // Customers see availability, never counts or costs.
        $inStock = ! $product->track_inventory || $product->stock_quantity > 0;

        return [
            'id' => $product->id,
            'type' => $product->type,
            'name' => $product->name,
            'description' => $product->description,
            'price' => $product->sellingPrice(),
            // Original price when a sale price is active, so clients can show a strikethrough.
            'original_price' => $product->sellingPrice() < (float) $product->price ? (float) $product->price : null,
            'brand' => $product->brand,
            'generic_name' => $product->generic_name,
            'requires_prescription' => (bool) $product->requires_prescription,
            'unit' => $product->unit,
            'sold_by' => $product->sold_by,
            'price_tiers' => $product->price_tiers,
            'min_order_qty' => $product->min_order_qty !== null ? (float) $product->min_order_qty : null,
            'duration_minutes' => $product->duration_minutes,
            'category' => $product->category?->only(['id', 'name']),
            'images' => $product->images->map(fn ($i) => $i->url)->filter()->values()->all(),
            'in_stock' => $inStock,
            'available_now' => $product->isAvailableNow($timezone),
            'available_from' => $product->available_from,
            'available_until' => $product->available_until,
            'variants' => $product->variants->map(fn ($v) => [
                'id' => $v->id,
                'name' => $v->name,
                'price' => $v->price,
                'in_stock' => $v->stock_quantity > 0,
            ])->all(),
            'modifier_groups' => $product->modifierGroups->map(fn ($g) => [
                'id' => $g->id,
                'name' => $g->name,
                'type' => $g->type,
                'min_select' => $g->min_select,
                'max_select' => $g->max_select,
                'options' => $g->options->map(fn ($o) => [
                    'id' => $o->id,
                    'name' => $o->name,
                    'price_delta' => $o->price_delta,
                    'is_default' => $o->is_default,
                ])->all(),
            ])->all(),
        ];
    }
}
