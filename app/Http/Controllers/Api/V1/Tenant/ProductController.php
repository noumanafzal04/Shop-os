<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Catalog\CreateProductAction;
use App\Actions\Catalog\GenerateBarcodeAction;
use App\Actions\Catalog\SyncModifierGroupsAction;
use App\Actions\Catalog\UpdateProductAction;
use App\Http\Requests\Catalog\SyncModifierGroupsRequest;
use App\Http\Controllers\Controller;
use App\Http\Requests\Catalog\StoreProductRequest;
use App\Http\Requests\Catalog\UpdateProductRequest;
use App\Exceptions\DomainException;
use App\Models\Product;
use App\Support\ApiResponse;
use App\Support\ItemTypes;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProductController extends Controller
{
    /**
     * Paginated item list — searchable, filterable by type/category/status.
     */
    public function index(Request $request, \App\Support\BranchContext $branch): JsonResponse
    {
        $products = Product::query()
            ->with(['category:id,name', 'variants', 'images', 'collections:id,name', 'modifierGroups.options', 'barcodes:id,product_id,barcode', 'units', 'comboItems.component:id,name', 'recipeItems.ingredient:id,name'])
            ->when($request->query('search'), function ($q, $search): void {
                $q->where(function ($q) use ($search): void {
                    // Match name, brand, generic/salt (pharmacy), SKU, primary
                    // or alternate barcode so a pharmacist can find a medicine
                    // by its salt and a shopkeeper by any barcode on the pack.
                    $q->where('name', 'like', "%{$search}%")
                        ->orWhere('brand', 'like', "%{$search}%")
                        ->orWhere('generic_name', 'like', "%{$search}%")
                        ->orWhere('description', 'like', "%{$search}%")
                        ->orWhere('sku', 'like', "%{$search}%")
                        ->orWhere('barcode', 'like', "%{$search}%")
                        ->orWhereHas('barcodes', fn ($b) => $b->where('barcode', 'like', "%{$search}%"))
                        ->orWhereHas('category', fn ($c) => $c->where('name', 'like', "%{$search}%"))
                        ->orWhereHas('variants', fn ($v) => $v->where('sku', 'like', "%{$search}%"));
                });
            })
            ->when($request->query('type'), fn ($q, $type) => $q->where('type', $type))
            ->when($request->query('item_type'), fn ($q, $t) => $q->where('item_type', $t))
            ->when($request->query('collection_id'), fn ($q, $cid) => $q->whereHas('collections', fn ($c) => $c->where('collections.id', $cid)))
            ->when($request->query('category_id'), fn ($q, $id) => $q->where('category_id', $id))
            ->when($request->has('is_active'), fn ($q) => $q->where('is_active', $request->boolean('is_active')))
            ->when($request->boolean('low_stock'), function ($q): void {
                $q->where('track_inventory', true)
                    ->whereNotNull('low_stock_threshold')
                    ->whereColumn('stock_quantity', '<=', 'low_stock_threshold');
            })
            ->orderByDesc('created_at')
            ->paginate(min((int) $request->query('per_page', 15), 100));

        // Per-branch price display: stamp each item with the operating branch's
        // product-level override (null = catalog price) so the POS/list show the
        // price this branch will actually charge (Phase 4c).
        if ($branchId = $branch->id()) {
            $ids = collect($products->items())->pluck('id');
            $overrides = \App\Models\BranchPrice::query()
                ->where('branch_id', $branchId)
                ->whereNull('variant_id')
                ->whereIn('product_id', $ids)
                ->pluck('price', 'product_id');
            foreach ($products as $p) {
                $p->branch_price = isset($overrides[$p->id]) ? (string) $overrides[$p->id] : null;
            }
        }

        return ApiResponse::paginated($products);
    }

    public function store(StoreProductRequest $request, CreateProductAction $action): JsonResponse
    {
        $result = $action->execute($request->validated());

        return response()->json([
            'success' => true,
            'message' => 'Item created',
            'data' => $result['product'],
            'errors' => (object) [],
            'meta' => (object) array_filter(['warnings' => $result['warnings']]),
        ], 201);
    }

    /** Bulk-import products from a CSV — create/update by SKU, per-row results. */
    public function import(Request $request, \App\Actions\Catalog\ImportProductsAction $action): JsonResponse
    {
        $request->validate(['file' => ['required', 'file', 'max:4096']]);

        $summary = $action->execute($request->file('file')->get());

        return ApiResponse::ok(
            $summary,
            "Imported {$summary['created']} new, updated {$summary['updated']}, {$summary['failed']} failed.",
        );
    }

    /** A ready-to-fill CSV template with the supported columns + one example row. */
    public function importTemplate(): \Symfony\Component\HttpFoundation\StreamedResponse
    {
        $header = ['name', 'item_type', 'sku', 'barcode', 'barcodes', 'plu_code', 'brand', 'generic_name', 'requires_prescription', 'category', 'unit', 'sold_by', 'price', 'cost', 'discount_price', 'tax_rate', 'stock_quantity', 'low_stock_threshold', 'min_order_qty', 'is_active', 'visible_in_marketplace'];

        // A few worked examples so a merchant sees how each column is filled:
        // a retail item, a weight-sold grocery item with a scale PLU code, a
        // discounted item, and a prescription medicine with two extra barcodes.
        $samples = [
            ['Classic T-Shirt', 'physical_product', 'TS-01', '8964000100', '', '', 'ACME', '', '0', 'Clothing', 'pcs', 'unit', '1200', '700', '', '0', '40', '5', '', '1', '1'],
            ['Loose Sugar', 'physical_product', 'SUG-KG', '', '', '21', '', '', '0', 'Grocery', 'kg', 'weight', '180', '150', '', '0', '100', '10', '', '1', '1'],
            ['Cooking Oil 5L', 'physical_product', 'OIL-5L', '8964000200', '', '', 'Dalda', '', '0', 'Grocery', 'bottle', 'unit', '2800', '2500', '2650', '0', '30', '6', '', '1', '1'],
            ['Panadol 500mg', 'medicine', 'PAN-500', '8964000111', '8964000112|8964000113', '', 'GSK', 'Paracetamol 500mg', '1', 'Medicines', 'strip', 'unit', '120', '90', '', '0', '200', '20', '', '1', '1'],
        ];

        return response()->streamDownload(function () use ($header, $samples): void {
            $out = fopen('php://output', 'w');
            fputcsv($out, $header);
            foreach ($samples as $row) {
                fputcsv($out, $row);
            }
            fclose($out);
        }, 'products-import-template.csv', ['Content-Type' => 'text/csv']);
    }

    /**
     * Export the item catalog to CSV. Honours the same filters as index() so a
     * merchant can "export what I'm looking at", and emits the SAME columns as
     * the import template — an exported file round-trips straight back through
     * /products/import for bulk edits.
     */
    public function export(Request $request): \Symfony\Component\HttpFoundation\StreamedResponse
    {
        $header = ['name', 'item_type', 'sku', 'barcode', 'barcodes', 'plu_code', 'brand', 'generic_name', 'requires_prescription', 'category', 'unit', 'sold_by', 'price', 'cost', 'discount_price', 'tax_rate', 'stock_quantity', 'low_stock_threshold', 'min_order_qty', 'is_active', 'visible_in_marketplace'];

        $rows = Product::query()
            ->with(['category:id,name', 'barcodes:id,product_id,barcode'])
            ->when($request->query('search'), function ($q, $search): void {
                $q->where(function ($q) use ($search): void {
                    $q->where('name', 'like', "%{$search}%")
                        ->orWhere('brand', 'like', "%{$search}%")
                        ->orWhere('generic_name', 'like', "%{$search}%")
                        ->orWhere('sku', 'like', "%{$search}%")
                        ->orWhere('barcode', 'like', "%{$search}%");
                });
            })
            ->when($request->query('type'), fn ($q, $type) => $q->where('type', $type))
            ->when($request->query('item_type'), fn ($q, $t) => $q->where('item_type', $t))
            ->when($request->query('category_id'), fn ($q, $id) => $q->where('category_id', $id))
            ->when($request->has('is_active'), fn ($q) => $q->where('is_active', $request->boolean('is_active')))
            ->when($request->boolean('low_stock'), function ($q): void {
                $q->where('track_inventory', true)
                    ->whereNotNull('low_stock_threshold')
                    ->whereColumn('stock_quantity', '<=', 'low_stock_threshold');
            })
            ->orderBy('name')
            ->get()
            ->map(fn (Product $p) => [
                $p->name,
                $p->item_type,
                $p->sku,
                $p->barcode,
                $p->barcodes->pluck('barcode')->reject(fn ($b) => $b === $p->barcode)->implode('|'),
                $p->plu_code,
                $p->brand,
                $p->generic_name,
                $p->requires_prescription ? 1 : 0,
                $p->category?->name,
                $p->unit,
                $p->sold_by,
                $p->price,
                $p->cost,
                $p->discount_price,
                $p->tax_rate,
                $p->stock_quantity,
                $p->low_stock_threshold,
                $p->min_order_qty,
                $p->is_active ? 1 : 0,
                $p->visible_in_marketplace ? 1 : 0,
            ])
            ->all();

        return \App\Support\CsvExport::stream('products-'.now()->format('Y-m-d').'.csv', $header, $rows);
    }

    public function show(string $id): JsonResponse
    {
        return ApiResponse::ok(
            Product::query()->with(['category', 'variants', 'images', 'collections', 'modifierGroups.options', 'barcodes:id,product_id,barcode', 'units', 'comboItems.component:id,name', 'recipeItems.ingredient:id,name'])->findOrFail($id),
        );
    }

    /**
     * Cross-branch availability — this product's on-hand at every active branch
     * (0 where a branch holds none). Powers the "check other branches" lookup.
     */
    public function branchStock(string $id): JsonResponse
    {
        /** @var Product $product */
        $product = Product::query()->findOrFail($id);

        $rows = \App\Models\Branch::query()
            ->where('is_active', true)
            ->orderByDesc('is_default')
            ->orderBy('name')
            ->get(['id', 'name', 'is_default'])
            ->map(fn ($b) => [
                'branch_id' => $b->id,
                'branch' => $b->name,
                'is_default' => $b->is_default,
                'quantity' => (float) \App\Models\BranchStock::query()
                    ->where('branch_id', $b->id)
                    ->where('product_id', $product->id)
                    ->sum('quantity'),
            ]);

        return ApiResponse::ok($rows);
    }

    /**
     * Serial units on record for this product. Defaults to in_stock (the POS
     * serial picker for a serialized sale); pass ?status=sold or ?status=all
     * to widen. Most recent first.
     */
    public function serials(string $id, \Illuminate\Http\Request $request): JsonResponse
    {
        $product = Product::query()->findOrFail($id);
        $status = $request->query('status', 'in_stock');

        $rows = \App\Models\ProductSerial::query()
            ->where('product_id', $product->id)
            ->when($status !== 'all', fn ($q) => $q->where('status', $status))
            ->latest('received_at')
            ->latest('created_at')
            ->get(['id', 'serial', 'status', 'variant_id', 'branch_id', 'sale_id', 'received_at']);

        return ApiResponse::ok($rows);
    }

    /**
     * Per-branch price overrides for a product — the base (catalog) price plus,
     * for every active branch, its product-level override (null = uses base).
     * Powers the "branch pricing" editor.
     */
    public function branchPrices(string $id): JsonResponse
    {
        /** @var Product $product */
        $product = Product::query()->findOrFail($id);

        $overrides = \App\Models\BranchPrice::query()
            ->where('product_id', $product->id)
            ->whereNull('variant_id')
            ->pluck('price', 'branch_id');

        $branches = \App\Models\Branch::query()
            ->where('is_active', true)
            ->orderByDesc('is_default')
            ->orderBy('name')
            ->get(['id', 'name', 'is_default'])
            ->map(fn ($b) => [
                'branch_id' => $b->id,
                'branch' => $b->name,
                'is_default' => $b->is_default,
                'price' => isset($overrides[$b->id]) ? (string) $overrides[$b->id] : null,
            ]);

        return ApiResponse::ok([
            'base_price' => (string) $product->price,
            'branches' => $branches,
        ]);
    }

    /**
     * Upsert / clear a product's per-branch price overrides (product-level).
     * Body: { prices: [{ branch_id, price: number|null }] } — a null price
     * clears that branch's override (it falls back to the catalog price).
     */
    public function setBranchPrices(\App\Http\Requests\Catalog\SetBranchPricesRequest $request, string $id): JsonResponse
    {
        /** @var Product $product */
        $product = Product::query()->findOrFail($id);
        $tenantId = $product->tenant_id;

        foreach ($request->validated('prices') as $row) {
            if (($row['price'] ?? null) === null) {
                \App\Models\BranchPrice::query()
                    ->where('branch_id', $row['branch_id'])
                    ->where('product_id', $product->id)
                    ->whereNull('variant_id')
                    ->delete();

                continue;
            }

            \App\Models\BranchPrice::query()->updateOrCreate(
                ['branch_id' => $row['branch_id'], 'product_id' => $product->id, 'variant_id' => null],
                ['tenant_id' => $tenantId, 'price' => round((float) $row['price'], 2)],
            );
        }

        return $this->branchPrices($product->id);
    }

    /** Replace the whole modifier-group set for a menu item. */
    public function syncModifiers(SyncModifierGroupsRequest $request, string $id, SyncModifierGroupsAction $action): JsonResponse
    {
        $product = Product::query()->findOrFail($id);
        $groups = $request->validated('groups');

        // Capability matrix: only item types that support modifiers (food)
        // may carry them — a pharmacy can't attach "extra shot" to a medicine.
        // Clearing (empty set) is always allowed, whatever the type.
        if (! empty($groups) && ! ItemTypes::supports($product->item_type, 'modifiers')) {
            throw DomainException::unprocessable(
                'Modifiers are not available for this item type.',
                'MODIFIERS_NOT_SUPPORTED',
            );
        }

        return ApiResponse::ok($action->execute($product, $groups), 'Modifiers saved');
    }

    public function update(UpdateProductRequest $request, string $id, UpdateProductAction $action): JsonResponse
    {
        $result = $action->execute(Product::query()->findOrFail($id), $request->validated());

        return response()->json([
            'success' => true,
            'message' => 'Item updated',
            'data' => $result['product'],
            'errors' => (object) [],
            'meta' => (object) array_filter(['warnings' => $result['warnings']]),
        ]);
    }

    /** Assign a unique scannable barcode to an item that lacks one. */
    public function generateBarcode(string $id, GenerateBarcodeAction $action): JsonResponse
    {
        $product = $action->execute(Product::query()->findOrFail($id));

        return ApiResponse::ok($product->only('id', 'name', 'barcode'), 'Barcode generated');
    }

    /**
     * Soft delete — sales/reservations referencing this item keep their
     * history (the "product in active sale" edge case).
     */
    public function destroy(string $id): JsonResponse
    {
        $product = Product::query()->findOrFail($id);
        $product->variants()->delete(); // soft
        $product->delete();             // soft

        return ApiResponse::noContent('Item deleted');
    }
}
