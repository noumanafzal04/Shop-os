<?php

namespace App\Http\Controllers\Api\V1\Marketplace;

use App\Http\Controllers\Controller;
use App\Models\Banner;
use App\Models\Branch;
use App\Models\Category;
use App\Models\City;
use App\Models\GalleryImage;
use App\Models\Product;
use App\Models\Tenant;
use App\Support\ApiResponse;
use App\Support\Geo;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

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

        $city = City::query()
            ->where('is_active', true)
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->orderByRaw(Geo::sqlDistanceKm((float) $data['lat'], (float) $data['lng']))
            ->first();

        if ($city === null) {
            return ApiResponse::ok(['city' => null, 'in_service_area' => false]);
        }

        $distance = Geo::distanceKm(
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
            $expr = Geo::sqlDistanceKm($lat, $lng);
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
            $distance = Geo::distanceKm($lat, $lng, (float) $tenant->latitude, (float) $tenant->longitude);
            $radius = $tenant->setting('delivery_radius_km');
            $payload['distance_km'] = $distance;
            $payload['delivers_to_me'] = $tenant->deliveryEnabled()
                && ($radius === null || $distance <= (float) $radius);
        }

        return ApiResponse::ok($payload);
    }

    /**
     * THE AISLE. Everything on sale anywhere, not one shop at a time.
     *
     * `products()` below answers "what does this shop sell", which is the only
     * question the storefront could ask — so the marketplace could only ever be
     * a directory of shops with a catalog hidden one click inside each. A
     * customer does not shop for a shop. They shop for a thing, and then care
     * who has it.
     *
     * Every filter is optional and they compose. Sorting is explicit rather
     * than "relevance" magic, because a customer who picks "cheapest first"
     * has told you exactly what they want and reordering it is a bug.
     */
    public function browse(Request $request): JsonResponse
    {
        $f = $this->browseFilters($request);

        $query = $this->browseQuery($f);

        $sorted = match ($f['sort']) {
            'price_asc' => $query->orderByRaw(self::SELLING_PRICE.' ASC'),
            'price_desc' => $query->orderByRaw(self::SELLING_PRICE.' DESC'),
            'newest' => $query->orderByDesc('products.created_at'),
            // Deepest cut first. A zero-discount row would divide by price and
            // sort as 0, which is where it belongs.
            'discount' => $query->orderByRaw('((products.price - COALESCE(products.discount_price, products.price)) / NULLIF(products.price, 0)) DESC'),
            'rating' => $query->orderByDesc('shop_rating')->orderBy('products.name'),
            default => $query->orderBy('products.name'),
        };

        $page = $sorted
            ->with([
                'category:id,name', 'images',
                'variants' => fn ($q) => $q->where('is_active', true),
                'modifierGroups' => fn ($q) => $q->with(['options' => fn ($o) => $o->where('is_active', true)]),
            ])
            ->paginate(min((int) $request->query('per_page', 24), 60));

        // The shops these products belong to, in ONE query rather than one per
        // row — a page of twenty-four products from twelve shops is twelve
        // lookups repeated twice otherwise.
        $shops = Tenant::query()
            ->whereIn('id', $page->getCollection()->pluck('tenant_id')->unique())
            ->with('city:id,name')
            ->withAvg(['reviews as rating_avg' => fn ($q) => $q->where('is_published', true)], 'rating')
            ->withCount(['reviews as reviews_count' => fn ($q) => $q->where('is_published', true)])
            ->get()
            ->keyBy('id');

        $page->through(fn (Product $p) => $this->publicProductAt(
            $p,
            $this->defaultBranchOf($p->tenant_id),
            $shops->get($p->tenant_id)?->timezone,
        ) + [
            'shop' => ($shop = $shops->get($p->tenant_id)) === null ? null : [
                'slug' => $shop->slug,
                'business_name' => $shop->business_name,
                'business_type' => $shop->business_type,
                'city' => $shop->city?->only(['id', 'name']),
                'rating' => $shop->rating_avg !== null ? round((float) $shop->rating_avg, 1) : null,
                'delivery_fee' => (float) $shop->delivery_fee,
            ],
        ]);

        return ApiResponse::paginated($page);
    }

    /**
     * WHAT IS WORTH CLICKING, AND HOW MANY OF IT.
     *
     * A filter rail with hardcoded options is a rail that offers a city with
     * nothing in it and hides one with forty. Every option here is counted from
     * the same query the listing runs.
     *
     * Each axis is counted with every OTHER filter applied but not its own —
     * the standard behaviour, and the reason it matters: counting a city's
     * options with the city filter still on makes every unselected city read
     * zero, so choosing a different one looks impossible.
     */
    public function facets(Request $request): JsonResponse
    {
        $f = $this->browseFilters($request);

        $ids = fn (?string $except) => $this->browseQuery($f, $except)->reorder();

        $cities = City::query()
            ->whereIn('id', (clone $ids('city_id'))->select('tenants.city_id'))
            ->orderBy('name')
            ->get(['id', 'name'])
            ->map(fn (City $c) => [
                'id' => $c->id,
                'name' => $c->name,
                'products_count' => (clone $ids('city_id'))->where('tenants.city_id', $c->id)->count(),
            ]);

        $types = (clone $ids('business_type'))
            ->reorder()
            ->select('tenants.business_type')
            ->selectRaw('COUNT(*) as products_count')
            ->groupBy('tenants.business_type')
            ->orderByDesc('products_count')
            ->get()
            ->map(fn ($r) => ['type' => $r->business_type, 'products_count' => (int) $r->products_count])
            ->values();

        // Categories are per-shop rows, so across shops they can only be
        // grouped by NAME — "Beverages" at one shop and "Beverages" at another
        // are the same aisle to a customer and two ids to the database.
        $categories = (clone $ids('category'))
            ->reorder()
            ->join('categories', 'categories.id', '=', 'products.category_id')
            ->select('categories.name')
            ->selectRaw('COUNT(*) as products_count')
            ->groupBy('categories.name')
            ->orderByDesc('products_count')
            ->limit(40)
            ->get()
            ->map(fn ($r) => ['name' => $r->name, 'products_count' => (int) $r->products_count])
            ->values();

        // The sizes a customer can actually ask for, by name, across shops.
        $sizes = (clone $ids('size'))
            ->reorder()
            ->join('product_variants', function ($j): void {
                $j->on('product_variants.product_id', '=', 'products.id')
                    ->where('product_variants.is_active', true)
                    ->whereNull('product_variants.deleted_at');
            })
            ->select('product_variants.name')
            ->selectRaw('COUNT(DISTINCT products.id) as products_count')
            ->groupBy('product_variants.name')
            ->orderByDesc('products_count')
            ->limit(30)
            ->get()
            ->map(fn ($r) => ['name' => $r->name, 'products_count' => (int) $r->products_count])
            ->values();

        // `select`, NOT `selectRaw`. selectRaw APPENDS, so this aggregate
        // arrived on top of the base query's `products.*` and its shop-rating
        // subselect — and MySQL under only_full_group_by refuses an aggregate
        // beside a non-aggregated column. SQLite allows it, which is exactly
        // how this reached a running server: every test was green and the
        // endpoint answered 500 on the first real request.
        $range = (clone $ids('price'))
            ->reorder()
            ->select(DB::raw(
                'MIN('.self::SELLING_PRICE.') as low, MAX('.self::SELLING_PRICE.') as high',
            ))
            ->first();

        return ApiResponse::ok([
            'total' => $this->browseQuery($f)->reorder()->count(),
            'cities' => $cities,
            'business_types' => $types,
            'categories' => $categories,
            'sizes' => $sizes,
            'price' => [
                'min' => $range?->low !== null ? (float) $range->low : 0.0,
                'max' => $range?->high !== null ? (float) $range->high : 0.0,
            ],
            'on_sale_count' => (clone $ids('on_sale'))->whereNotNull('products.discount_price')
                ->whereColumn('products.discount_price', '<', 'products.price')->count(),
        ]);
    }

    /**
     * One product, on its own page, with the shop that sells it.
     *
     * There was no public endpoint for a single item at all: the only way to
     * see a product was to load its shop's whole catalog and find it in the
     * array, which cannot be linked to, shared, or opened from a search
     * result.
     */
    public function product(Request $request, string $id): JsonResponse
    {
        $visibleShopIds = Tenant::query()->marketplaceVisible()->select('id');

        $product = Product::withoutTenancy()
            ->whereIn('tenant_id', $visibleShopIds)
            ->where('is_active', true)
            ->where('visible_in_marketplace', true)
            ->with([
                'category:id,name', 'images',
                'variants' => fn ($q) => $q->where('is_active', true),
                'modifierGroups' => fn ($q) => $q->with(['options' => fn ($o) => $o->where('is_active', true)]),
            ])
            ->findOrFail($id);

        $shop = Tenant::query()
            ->with('city:id,name')
            ->withAvg(['reviews as rating_avg' => fn ($q) => $q->where('is_published', true)], 'rating')
            ->withCount(['reviews as reviews_count' => fn ($q) => $q->where('is_published', true)])
            ->findOrFail($product->tenant_id);

        // What else this shop sells, so the page has somewhere to go next.
        $also = Product::withoutTenancy()
            ->where('tenant_id', $product->tenant_id)
            ->where('is_active', true)
            ->where('visible_in_marketplace', true)
            ->whereKeyNot($product->id)
            ->when($product->category_id, fn ($q, $cid) => $q->where('category_id', $cid))
            ->with('images')
            ->inRandomOrder()
            ->limit(8)
            ->get()
            ->map(fn (Product $p) => [
                'id' => $p->id,
                'name' => $p->name,
                'price' => $p->sellingPrice(),
                'original_price' => $p->sellingPrice() < (float) $p->price ? (float) $p->price : null,
                'images' => $p->images->map(fn ($i) => $i->url)->filter()->values()->all(),
                'shop_slug' => $shop->slug,
            ]);

        return ApiResponse::ok(
            $this->publicProductAt($product, $this->defaultBranchOf($product->tenant_id), $shop->timezone) + [
                'shop' => $this->publicShop($shop),
                'also_from_this_shop' => $also,
            ],
        );
    }

    /**
     * The price a customer is actually charged, in SQL.
     *
     * Written once because `Product::sellingPrice()` decides the same thing in
     * PHP, and a filter that disagrees with the price on the card is worse than
     * no filter: "under Rs 500" would list a product whose sticker says 800.
     * The two conditions here are that method's, exactly — a discount counts
     * only when it is set, positive, and actually lower.
     */
    private const SELLING_PRICE = '(CASE WHEN products.discount_price IS NOT NULL'
        .' AND products.discount_price > 0 AND products.discount_price < products.price'
        .' THEN products.discount_price ELSE products.price END)';

    /** @return array<string, mixed> */
    private function browseFilters(Request $request): array
    {
        return $request->validate([
            'q' => ['nullable', 'string', 'max:80'],
            // A named set of items rather than a search — what the saved list
            // asks for. One request instead of one per heart.
            'ids' => ['nullable', 'string', 'max:2000'],
            'city_id' => ['nullable', 'uuid'],
            'business_type' => ['nullable', 'string', 'max:40'],
            'shop_slug' => ['nullable', 'string', 'max:120'],
            'category' => ['nullable', 'string', 'max:100'],
            'item_type' => ['nullable', 'string', 'max:40'],
            'size' => ['nullable', 'string', 'max:100'],
            'min_price' => ['nullable', 'numeric', 'min:0'],
            'max_price' => ['nullable', 'numeric', 'min:0'],
            'on_sale' => ['nullable', 'boolean'],
            'in_stock' => ['nullable', 'boolean'],
            'rating_min' => ['nullable', 'numeric', 'between:0,5'],
            'sort' => ['nullable', 'string', 'in:name,price_asc,price_desc,newest,discount,rating'],
        ]) + ['sort' => $request->query('sort', 'name')];
    }

    /**
     * The one query the listing and every facet count are built from.
     *
     * Shared rather than written twice, because a facet that says "Lahore (12)"
     * over a list that shows nine is a bug nobody can explain — and two copies
     * of a filter chain is how that happens.
     *
     * `$except` drops a single axis, which is what a facet needs to count its
     * own alternatives.
     */
    private function browseQuery(array $f, ?string $except = null): Builder
    {
        $on = fn (string $axis) => $except !== $axis && ($f[$axis] ?? null) !== null && ($f[$axis] ?? '') !== '';

        return Product::withoutTenancy()
            ->join('tenants', 'tenants.id', '=', 'products.tenant_id')
            ->where('products.is_active', true)
            ->where('products.visible_in_marketplace', true)
            // The same fence every other marketplace read goes through — a demo
            // shop's catalog must never appear beside a real one's.
            ->whereIn('products.tenant_id', Tenant::query()->marketplaceVisible()->select('id'))
            ->select('products.*')
            ->selectSub(
                fn ($q) => $q->from('reviews')
                    ->selectRaw('AVG(rating)')
                    ->whereColumn('reviews.tenant_id', 'products.tenant_id')
                    ->where('reviews.is_published', true),
                'shop_rating',
            )
            // PRESENT-BUT-EMPTY IS A REAL ANSWER for this one axis, and the
            // only one where it is. `?ids=` means "none of them" — a saved
            // list somebody has just emptied — while every other filter treats
            // an empty string as "not asked". Sharing the generic test would
            // fill that page with the entire aisle.
            ->when($except !== 'ids' && array_key_exists('ids', $f), function ($q) use ($f): void {
                $ids = array_slice(array_filter(array_map('trim', explode(',', (string) $f['ids']))), 0, 60);
                // An EMPTY set is not "no filter" — it is "none of them", and
                // answering it with the whole aisle would fill a saved list
                // somebody had just emptied.
                $q->whereIn('products.id', $ids === [] ? [''] : $ids);
            })
            ->when($on('q'), fn ($q) => $q->where(fn ($w) => $w
                ->where('products.name', 'like', "%{$f['q']}%")
                ->orWhere('products.brand', 'like', "%{$f['q']}%")
                ->orWhere('products.generic_name', 'like', "%{$f['q']}%")
                ->orWhere('products.description', 'like', "%{$f['q']}%")
                ->orWhere('tenants.business_name', 'like', "%{$f['q']}%")))
            ->when($on('city_id'), fn ($q) => $q->where('tenants.city_id', $f['city_id']))
            ->when($on('business_type'), fn ($q) => $q->where('tenants.business_type', $f['business_type']))
            ->when($on('shop_slug'), fn ($q) => $q->where('tenants.slug', $f['shop_slug']))
            ->when($on('item_type'), fn ($q) => $q->where('products.item_type', $f['item_type']))
            ->when($on('category'), fn ($q) => $q->whereExists(fn ($e) => $e->from('categories')
                ->whereColumn('categories.id', 'products.category_id')
                ->where('categories.name', $f['category'])))
            ->when($on('size'), fn ($q) => $q->whereExists(fn ($e) => $e->from('product_variants')
                ->whereColumn('product_variants.product_id', 'products.id')
                ->whereNull('product_variants.deleted_at')
                ->where('product_variants.is_active', true)
                ->where('product_variants.name', $f['size'])))
            // CAST, and not because the column needs it — because the BINDING
            // does. A PHP float binds as PDO::PARAM_STR, and SQLite orders every
            // number BELOW every string, so `2400 <= '500'` is true and a
            // "under Rs 500" filter returned the whole aisle. MySQL coerces and
            // hides it, so this only ever fails where the tests run.
            ->when($except !== 'price' && ($f['min_price'] ?? null) !== null,
                fn ($q) => $q->whereRaw(self::SELLING_PRICE.' >= CAST(? AS DECIMAL(14,2))', [(float) $f['min_price']]))
            ->when($except !== 'price' && ($f['max_price'] ?? null) !== null,
                fn ($q) => $q->whereRaw(self::SELLING_PRICE.' <= CAST(? AS DECIMAL(14,2))', [(float) $f['max_price']]))
            ->when($except !== 'on_sale' && ! empty($f['on_sale']), fn ($q) => $q
                ->whereNotNull('products.discount_price')
                ->whereColumn('products.discount_price', '<', 'products.price'))
            // A scalar subquery rather than EXISTS + HAVING: an aggregate needs
            // a GROUP BY to hang off, and SQLite says so out loud ("HAVING
            // clause on a non-aggregate query") while MySQL would quietly
            // answer something. A shop with no reviews reads 0 and is filtered
            // out, which is the honest answer to "4 stars and up".
            ->when($except !== 'rating_min' && ($f['rating_min'] ?? null) !== null, fn ($q) => $q
                ->whereRaw(
                    'COALESCE((SELECT AVG(rating) FROM reviews WHERE reviews.tenant_id = products.tenant_id'
                    .' AND reviews.is_published = ?), 0) >= CAST(? AS DECIMAL(4,2))',
                    [true, (float) $f['rating_min']],
                ))
            // "Available" means a customer can actually put it in a basket, so
            // it is BOTH questions: is there stock, and has the counter turned
            // it off tonight. Answering only the first offers a basket that is
            // refused at checkout, which is where the 86 button came from.
            ->when($except !== 'in_stock' && ! empty($f['in_stock']), fn ($q) => $q
                ->where(fn ($w) => $w
                    ->where('products.track_inventory', false)
                    ->orWhere('products.stock_quantity', '>', 0)
                    ->orWhereExists(fn ($e) => $e->from('product_variants')
                        ->whereColumn('product_variants.product_id', 'products.id')
                        ->whereNull('product_variants.deleted_at')
                        ->where('product_variants.is_active', true)
                        ->where('product_variants.stock_quantity', '>', 0)))
                ->whereNotExists(fn ($e) => $e->from('branch_sold_out')
                    ->join('branches', 'branches.id', '=', 'branch_sold_out.branch_id')
                    ->whereColumn('branch_sold_out.product_id', 'products.id')
                    ->whereNull('branch_sold_out.variant_id')
                    ->where('branches.is_default', true)));
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
                    ? Geo::distanceKm((float) $data['lat'], (float) $data['lng'], (float) $shop->latitude, (float) $shop->longitude)
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
            $expr = Geo::sqlDistanceKm((float) $data['lat'], (float) $data['lng']);
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
        $categories = Category::withoutTenancy()
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

        $banners = Banner::query()->live()
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
            $expr = Geo::sqlDistanceKm((float) $data['lat'], (float) $data['lng']);
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
                        ? Geo::distanceKm((float) $data['lat'], (float) $data['lng'], (float) $shop->latitude, (float) $shop->longitude)
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
                'categories' => Category::withoutTenancy()
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
                'gallery' => GalleryImage::withoutTenancy()
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
        return $this->publicProductAt($product, $this->defaultBranchOf($product->tenant_id), $timezone);
    }

    /**
     * The branch a shopfront answers from.
     *
     * Cached per tenant: a page of forty products must not ask forty times for
     * a row that cannot change while the page is being built.
     *
     * @var array<string, string|null>
     */
    private array $defaultBranch = [];

    private function defaultBranchOf(string $tenantId): ?string
    {
        return $this->defaultBranch[$tenantId] ??= Branch::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->where('is_default', true)
            ->value('id');
    }

    private function publicProductAt(Product $product, ?string $defaultBranchId, ?string $timezone = null): array
    {
        // Customers see availability, never counts or costs. A variant product
        // holds its stock on the variants, so roll them up — the parent
        // stock_quantity is orphaned and would otherwise mis-flag in/out.
        $inStock = ! $product->track_inventory || $product->effectiveStock() > 0;

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
            'strength' => $product->strength,
            'dosage_form' => $product->dosage_form,
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
            // Off the menu tonight. Published rather than filtered out, for the
            // same reason the serving window is: the shop HAS this normally,
            // the customer wants to know it exists, and the flag is undone when
            // the next delivery lands. Without it the only way to find out is
            // to build a basket and be refused at checkout.
            // Off at the branch the order will actually come out of — the
            // shop's default one, because nothing on `orders` names a branch
            // and the stock is drawn from there. A chain's online shop is its
            // main branch's shop until an order can say which kitchen it is
            // for. See docs/decisions/shopos-one-branch-runs-out.md.
            'sold_out' => $product->isSoldOut($defaultBranchId),
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
