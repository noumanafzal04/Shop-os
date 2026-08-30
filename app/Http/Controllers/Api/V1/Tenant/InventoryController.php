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
use App\Support\LowStock;
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

        // THE SAME RULE THE CATALOGUE USES.
        //
        // This read `products.stock_quantity` on its own, which is nought for
        // anything sold in sizes — so a shop holding two hundred shirts was
        // told to reorder every one of them. See LowStock.
        // `variants` is loaded, and not as a nicety. The screen renders a
        // sub-row per size — `p.variants.map(...)` with no guard — and this
        // list did not send the relation at all, so the reorder view threw the
        // moment it had a row to draw. It was only ever seen empty, which is
        // exactly why nobody met it. The size also matters on its own terms: a
        // rail is low because the Large ran out, and "order shirts" is not
        // something a buyer can act on.
        $products = LowStock::apply(Product::query(), $branchId)
            ->with(['category:id,name', 'variants'])
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

        // ── WHY THE LIST IS EMPTY ───────────────────────────────────
        //
        // Empty has two completely different causes and the screen said the
        // same thing for both: "nothing is below its reorder level" — which is
        // good news — and "no product in this shop has a reorder level set at
        // all", which means this screen can NEVER show anything and nobody is
        // being told.
        //
        // The second is the common one in a young shop, and it was reported as
        // a bug the day the list stopped showing false positives: every sized
        // product used to appear here regardless, so an empty list looked like
        // a breakage rather than an unconfigured feature.
        $watched = Product::query()
            ->where('track_inventory', true)
            ->whereNotNull('low_stock_threshold')
            ->count();

        return ApiResponse::ok($products, meta: ['watched' => $watched]);
    }
}
