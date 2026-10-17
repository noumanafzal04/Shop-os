<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Enums\PurchaseStatus;
use App\Http\Controllers\Controller;
use App\Models\BranchStock;
use App\Models\Product;
use App\Models\PurchaseOrderItem;
use App\Models\Supplier;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

/**
 * WHAT THIS SUPPLIER HAS SOLD US BEFORE — the next order's starting list.
 *
 * The user, 2026-10-17: a shop orders from the same distributor week after
 * week, and every new order was built one search at a time. Choosing the
 * supplier now opens everything ever bought from them — each item (each SIZE
 * of a design) once, with what was ordered last time, at what cost, when, and
 * what is on the shelf now — paged and searchable.
 *
 * Read from the orders themselves (any but cancelled), never a stored list: a
 * second copy of "who sells us this" drifts from the orders the first time one
 * is cancelled. An item since deleted or switched off is left out — it cannot
 * be ordered. The list is grouped and paged by the database, so a supplier
 * with five years of weekly orders costs one page of rows, not five years.
 */
class SupplierItemsController extends Controller
{
    /** "Select all" asks for the whole list at once; a supplier's catalogue is not larger than this. */
    public const MOST = 500;

    public function __invoke(Request $request, BranchContext $branch, string $supplier): JsonResponse
    {
        $supplier = Supplier::query()->findOrFail($supplier);
        $search = trim((string) $request->query('search', ''));
        $perPage = min(max((int) $request->query('per_page', 25), 1), self::MOST);

        $page = $this->linesFrom($supplier)
            ->join('products as p', 'p.id', '=', 'purchase_order_items.product_id')
            ->leftJoin('product_variants as v', 'v.id', '=', 'purchase_order_items.variant_id')
            ->whereNull('p.deleted_at')
            ->where('p.is_active', true)
            ->where(fn (Builder $size) => $size
                ->whereNull('purchase_order_items.variant_id')
                ->orWhere(fn (Builder $live) => $live->whereNull('v.deleted_at')->where('v.is_active', true)))
            ->when($search !== '', fn (Builder $q) => $q->where(fn (Builder $like) => $like
                ->where('p.name', 'like', "%{$search}%")
                ->orWhere('p.sku', 'like', "%{$search}%")
                ->orWhere('v.name', 'like', "%{$search}%")
                ->orWhere('v.sku', 'like', "%{$search}%")))
            ->groupBy('purchase_order_items.product_id', 'purchase_order_items.variant_id')
            // `first_line` is the tiebreak: two items may share a name, but no
            // order line belongs to two groups, so each row's lowest line id
            // is its own. Without it, same-named items slip between pages.
            ->selectRaw('purchase_order_items.product_id, purchase_order_items.variant_id,'
                .' MIN(p.name) as product_name, MIN(v.name) as size_name,'
                .' COUNT(DISTINCT purchase_order_items.purchase_order_id) as times_ordered,'
                .' MIN(purchase_order_items.id) as first_line')
            ->orderBy('product_name')
            ->orderBy('size_name')
            ->toBase()
            ->stably('first_line')->paginate($perPage);

        $last = $this->lastLines($supplier, collect($page->items())->pluck('product_id')->unique()->all());
        $products = Product::query()
            ->with(['variants', 'units'])
            ->whereIn('id', collect($page->items())->pluck('product_id')->unique()->all())
            ->get()
            ->keyBy('id');
        $shelf = $this->shelf($branch->scopeId(), $products->keys()->all());

        $page->setCollection(collect($page->items())->map(function ($row) use ($products, $last, $shelf, $branch): array {
            $key = self::key($row->product_id, $row->variant_id);
            /** @var Product $product */
            $product = $products->get($row->product_id);
            $variant = $row->variant_id === null ? null : $product->variants->firstWhere('id', $row->variant_id);
            /** @var PurchaseOrderItem $line */
            $line = $last->get($key);
            $threshold = $variant?->low_stock_threshold ?? $product->low_stock_threshold;

            return [
                'key' => $key,
                'product_id' => $product->id,
                'variant_id' => $variant?->id,
                'name' => $variant === null ? $product->name : "{$product->name} / {$variant->name}",
                'sku' => $variant?->sku ?? $product->sku,
                // A size takes no packs — the order's own rule (orderLines.ts).
                'units' => $variant === null
                    ? $product->units->map(fn ($u): array => ['id' => $u->id, 'name' => $u->name, 'factor' => (float) $u->factor])->values()->all()
                    : [],
                'track_inventory' => (bool) $product->track_inventory,
                // At the place being looked at; the whole shop when it is all of them.
                'in_stock' => round($branch->scopeId() === null
                    ? (float) ($variant?->stock_quantity ?? $product->stock_quantity)
                    : (float) ($shelf->get($key) ?? 0), 3),
                'low_stock_threshold' => $threshold === null ? null : (float) $threshold,
                'times_ordered' => (int) $row->times_ordered,
                'last' => [
                    'po_number' => $line->purchaseOrder->po_number,
                    'ordered_on' => $line->purchaseOrder->order_date?->format('Y-m-d'),
                    'quantity' => (float) $line->quantity_ordered,
                    'product_unit_id' => $line->product_unit_id,
                    'unit_name' => $line->unit_name,
                    // What it cost last time. Only buyers reach this list
                    // (purchases.manage), and every buyer may read a cost
                    // (Permissions::READS_COST names them).
                    'unit_cost' => (float) $line->unit_cost,
                ],
            ];
        }));

        return ApiResponse::paginated($page);
    }

    /** This supplier's order lines that name an item, from any order but a cancelled one. */
    private function linesFrom(Supplier $supplier): Builder
    {
        return PurchaseOrderItem::query()
            ->whereNotNull('purchase_order_items.product_id')
            ->whereHas('purchaseOrder', fn (Builder $po) => $po
                ->where('supplier_id', $supplier->id)
                ->where('status', '!=', PurchaseStatus::Cancelled));
    }

    /**
     * The newest line for each item on the page — "last time".
     *
     * @param  list<string>  $productIds
     * @return Collection<string, PurchaseOrderItem>
     */
    private function lastLines(Supplier $supplier, array $productIds): Collection
    {
        return $this->linesFrom($supplier)
            ->whereIn('purchase_order_items.product_id', $productIds)
            ->with('purchaseOrder:id,po_number,order_date,created_at')
            ->get()
            ->sortByDesc(fn (PurchaseOrderItem $l): string => $l->purchaseOrder->order_date?->format('Y-m-d')
                .'|'.$l->purchaseOrder->created_at?->format('Y-m-d H:i:s')
                .'|'.$l->created_at?->format('Y-m-d H:i:s'))
            ->unique(fn (PurchaseOrderItem $l): string => self::key($l->product_id, $l->variant_id))
            ->keyBy(fn (PurchaseOrderItem $l): string => self::key($l->product_id, $l->variant_id));
    }

    /**
     * What each item holds at one place, summed per item and size.
     *
     * @param  list<string>  $productIds
     * @return Collection<string, float>
     */
    private function shelf(?string $place, array $productIds): Collection
    {
        if ($place === null || $productIds === []) {
            return collect();
        }

        return BranchStock::query()
            ->where('branch_id', $place)
            ->whereIn('product_id', $productIds)
            ->get()
            ->groupBy(fn (BranchStock $s): string => self::key($s->product_id, $s->variant_id))
            ->map(fn (Collection $rows): float => (float) $rows->sum('quantity'));
    }

    private static function key(string $productId, ?string $variantId): string
    {
        return $productId.':'.($variantId ?? '');
    }
}
