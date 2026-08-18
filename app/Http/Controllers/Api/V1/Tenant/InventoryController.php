<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Http\Requests\Inventory\AdjustStockRequest;
use App\Models\Product;
use App\Models\StockMovement;
use App\Services\InventoryService;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\LastBoughtFrom;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class InventoryController extends Controller
{
    /**
     * Stock in / out / recount ("set"). The ONLY way stock changes by hand.
     *
     * It lands on the branch being OPERATED, like every other stock write —
     * receiving a lot (BatchController) and posting a stocktake
     * (StockCountController) both already resolve it this way, and a transfer
     * names both ends explicitly.
     *
     * This one did not, and defaulted to Main. The panel sends `X-Branch-Id` on
     * every request, so an owner who switched to their second branch and
     * corrected a count — a breakage, a recount, a write-off — had the
     * correction land on Main's shelf instead. Two shelves wrong from one
     * correct action, silently, while the screen they were looking at (low
     * stock, counts) was showing the other branch all along.
     *
     * The branch is resolved HERE and never taken from the body: BranchContext
     * already pins staff to their assignment, and accepting a branch id from
     * the client would let a cashier at one site adjust another site's stock.
     */
    public function adjust(
        AdjustStockRequest $request,
        InventoryService $inventory,
        BranchContext $branch,
    ): JsonResponse {
        $movement = $inventory->adjust([
            ...$request->validated(),
            // Null only on headless paths with no request branch; the service
            // falls back to Main there, which is where it belongs.
            'branch_id' => $branch->id(),
        ]);

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

        // …and WHO to buy each one from.
        //
        // The list could always say what was running out and never who sells
        // it, so a buyer read this screen and then typed the entire order again
        // by hand into Purchase Orders. The answer was in the shop's own
        // purchase history the whole time — every delivery records the
        // supplier, the product and what was paid. See LastBoughtFrom for why
        // it is the LAST supplier rather than the cheapest or the most
        // frequent.
        $lastBought = LastBoughtFrom::forProducts($products->pluck('id')->all());

        $products->each(function (Product $p) use ($lastBought): void {
            $last = $lastBought->get($p->id);
            // Absent, never invented. A product nobody has ever bought has no
            // supplier to suggest, and guessing one would put a real order in
            // front of a stranger.
            $p->setAttribute('last_supplier_id', $last?->supplier_id);
            $p->setAttribute('last_supplier_name', $last?->supplier_name);
            $p->setAttribute('last_unit_cost', $last?->unit_cost);
        });

        return ApiResponse::ok($products);
    }
}
