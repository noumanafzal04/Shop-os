<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\LowStock;
use App\Support\StockByPlace;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Stock by place — one row per product, one column per place.
 *
 * A page of products, and three more queries however long the page or however
 * many places: what each place holds, what is on the road, and the sizes.
 */
class StockByPlaceController extends Controller
{
    private const PER_PAGE = 25;

    public function index(Request $request, TenantContext $tenant, BranchContext $branch): JsonResponse
    {
        $places = StockByPlace::places($tenant->id());

        // "Running low here, and held somewhere else" is asked about ONE
        // place — the one named, or the one being worked at.
        $at = $places->firstWhere('id', $request->query('at'))?->id ?? $branch->id();
        $refill = $request->query('only') === 'refill' && $at !== null;

        $products = Product::query()
            ->where('track_inventory', true)
            ->when($request->query('search'), function ($q, $search): void {
                $q->where(fn ($w) => $w
                    ->where('name', 'like', "%{$search}%")
                    ->orWhere('brand', 'like', "%{$search}%")
                    ->orWhere('sku', 'like', "%{$search}%")
                    ->orWhere('barcode', 'like', "%{$search}%"));
            })
            ->when($refill, fn ($q) => LowStock::apply($q, $at)->whereExists(fn ($held) => $held
                ->selectRaw('1')
                ->from('branch_stock as elsewhere')
                ->whereColumn('elsewhere.product_id', 'products.id')
                ->where('elsewhere.branch_id', '<>', $at)
                ->where('elsewhere.quantity', '>', 0)))
            ->with(['variants:id,product_id,name'])
            ->orderBy('name')
            ->stably()->paginate(self::PER_PAGE, ['id', 'name', 'sku', 'low_stock_threshold']);

        $ids = collect($products->items())->pluck('id')->all();
        $held = StockByPlace::onHand($ids);
        $moving = StockByPlace::onTheRoad($ids);

        $rows = collect($products->items())->map(function (Product $p) use ($held, $moving): array {
            $mine = $held[$p->id] ?? [];
            $road = $moving[$p->id] ?? [];

            // Every place's figure for the product as a whole: its own row,
            // or its sizes added up.
            $perPlace = [];
            foreach ($mine as $byPlace) {
                foreach ($byPlace as $placeId => $qty) {
                    $perPlace[$placeId] = round(($perPlace[$placeId] ?? 0) + $qty, 3);
                }
            }

            return [
                'id' => $p->id,
                'name' => $p->name,
                'sku' => $p->sku,
                'low_stock_threshold' => $p->low_stock_threshold === null ? null : (float) $p->low_stock_threshold,
                'places' => (object) $perPlace,
                'on_the_road' => round(array_sum($road), 3),
                // The road is still the shop's: 7 on the shelves and 4 on the
                // van is 11, not 7 (retail #14).
                'total' => round(array_sum($perPlace) + array_sum($road), 3),
                'sizes' => $p->variants->map(fn ($v): array => [
                    'id' => $v->id,
                    'name' => $v->name,
                    'places' => (object) ($mine[$v->id] ?? []),
                    'on_the_road' => round($road[$v->id] ?? 0, 3),
                    'total' => round(array_sum($mine[$v->id] ?? []) + ($road[$v->id] ?? 0), 3),
                ])->values(),
            ];
        });

        return ApiResponse::paginated($products->setCollection($rows), 'OK', [
            'places' => $places->map(fn ($b): array => [
                'id' => $b->id,
                'name' => $b->name,
                'kind' => $b->kind,
                'is_default' => $b->is_default,
            ])->values(),
            'at' => $at,
        ]);
    }
}
