<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Http\Requests\Inventory\AdjustStockRequest;
use App\Models\Product;
use App\Models\StockMovement;
use App\Services\InventoryService;
use App\Support\ApiResponse;
use App\Support\BranchContext;
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
     *
     * Answers about the SHELF being looked at. `products.stock_quantity` is the
     * roll-up across every branch, so a chain read it as one number: a branch
     * manager opened the reorder list on the morning their own shelf was bare
     * and saw nothing, because the other shop across town still had stock. That
     * is the exact morning the screen exists for.
     *
     * `scopeId()` rather than `id()` — this is a READ, and null correctly means
     * an owner's all-branches view, which still wants the tenant-wide roll-up.
     */
    public function lowStock(BranchContext $branch): JsonResponse
    {
        $branchId = $branch->scopeId();

        $products = Product::query()
            ->where('track_inventory', true)
            ->whereNotNull('low_stock_threshold')
            ->when(
                $branchId === null,
                fn ($q) => $q->whereColumn('stock_quantity', '<=', 'low_stock_threshold'),
                // A correlated subquery rather than a join: a product with no
                // row on this branch's shelf holds none of it, which is the
                // most urgent case of all and a join would drop it.
                fn ($q) => $q->whereRaw(
                    '(select coalesce(sum(bs.quantity), 0) from branch_stock bs'
                    .' where bs.product_id = products.id and bs.branch_id = ?) <= products.low_stock_threshold',
                    [$branchId],
                ),
            )
            ->with('category:id,name')
            ->orderBy('stock_quantity')
            ->get();

        return ApiResponse::ok($products);
    }
}
