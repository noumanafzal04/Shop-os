<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Http\Requests\Inventory\AdjustStockRequest;
use App\Models\Product;
use App\Models\StockMovement;
use App\Services\InventoryService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class InventoryController extends Controller
{
    /**
     * Stock in / out / recount ("set"). The ONLY way stock changes by hand.
     */
    public function adjust(AdjustStockRequest $request, InventoryService $inventory): JsonResponse
    {
        $movement = $inventory->adjust($request->validated());

        return ApiResponse::created(
            $movement->load('product:id,name,stock_quantity', 'variant:id,name,stock_quantity'),
            'Stock updated',
        );
    }

    /**
     * Movement history — filterable by product, newest first.
     */
    public function movements(Request $request): JsonResponse
    {
        $movements = StockMovement::query()
            ->with(['product:id,name', 'variant:id,name'])
            ->when($request->query('product_id'), fn ($q, $id) => $q->where('product_id', $id))
            ->when($request->query('type'), fn ($q, $type) => $q->where('type', $type))
            ->orderByDesc('created_at')
            ->paginate(min((int) $request->query('per_page', 20), 100));

        return ApiResponse::paginated($movements);
    }

    /**
     * Everything at or below its low-stock threshold.
     */
    public function lowStock(): JsonResponse
    {
        $products = Product::query()
            ->where('track_inventory', true)
            ->whereNotNull('low_stock_threshold')
            ->whereColumn('stock_quantity', '<=', 'low_stock_threshold')
            ->with('category:id,name')
            ->orderBy('stock_quantity')
            ->get();

        return ApiResponse::ok($products);
    }
}
