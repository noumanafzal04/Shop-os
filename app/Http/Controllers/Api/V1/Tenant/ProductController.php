<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Catalog\CreateProductAction;
use App\Actions\Catalog\GenerateBarcodeAction;
use App\Actions\Catalog\ImportProductsAction;
use App\Actions\Catalog\SyncModifierGroupsAction;
use App\Actions\Catalog\UpdateProductAction;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Catalog\SetBranchPricesRequest;
use App\Http\Requests\Catalog\StoreProductRequest;
use App\Http\Requests\Catalog\SyncModifierGroupsRequest;
use App\Http\Requests\Catalog\UpdateProductRequest;
use App\Models\Branch;
use App\Models\BranchPrice;
use App\Models\BranchSoldOut;
use App\Models\BranchStock;
use App\Models\Product;
use App\Models\ProductSerial;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\BusinessTypes;
use App\Support\CsvExport;
use App\Support\ItemTypes;
use App\Support\ProductCsv;
use App\Support\RecipeCost;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ProductController extends Controller
{
    /**
     * Paginated item list — searchable, filterable by type/category/status.
     */
    public function index(Request $request, BranchContext $branch): JsonResponse
    {
        $products = Product::query()
            ->with(['category:id,name', 'variants', 'images', 'collections:id,name', 'modifierGroups.options', 'barcodes:id,product_id,variant_id,barcode', 'units', 'comboItems.component:id,name', 'recipeItems.ingredient:id,name'])
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
                    ->where(function ($w): void {
                        // No variants → the product's own stock is the truth.
                        $w->where(function ($x): void {
                            $x->whereDoesntHave('variants')
                                ->whereColumn('stock_quantity', '<=', 'low_stock_threshold');
                        })
                            // Has variants → stock lives on the variants; the
                            // parent stock_quantity is orphaned, so compare the
                            // live variant sum against the threshold instead.
                            ->orWhere(function ($x): void {
                                $x->whereHas('variants')
                                    ->whereRaw('(select coalesce(sum(pv.stock_quantity), 0) from product_variants pv where pv.product_id = products.id and pv.deleted_at is null) <= low_stock_threshold');
                            });
                    });
            })
            ->orderByDesc('created_at')
            ->paginate(min((int) $request->query('per_page', 15), 100));

        static::stampBranchFigures($products, $products->items(), $branch->id());

        return ApiResponse::paginated($products);
    }

    /**
     * What this branch charges, and what this branch actually holds.
     *
     * Extracted so the product list and the quick-keys strip cannot drift. They
     * had drifted: the list stamped a branch price and the strip stamped nothing,
     * so the same product tapped from two places on the same screen could answer
     * two different questions about stock. One implementation, two callers.
     *
     * @param  iterable<int, Product>  $products
     * @param  array<int, Product>  $rows
     */
    public static function stampBranchFigures(iterable $products, array $rows, ?string $branchId): void
    {
        if ($branchId === null) {
            return;
        }

        $ids = collect($rows)->pluck('id');

        // WHAT THIS BRANCH HAS RUN OUT OF TONIGHT.
        //
        // 86 used to be a column on the product, so the list serialised it for
        // free. It is a row per branch now — a kitchen runs out, a chain does
        // not — and the catalogue has to say which answer it is showing, or a
        // manager looking at Gulberg sees DHA's evening.
        //
        // Stamped here beside the branch price and the branch stock, for the
        // reason those are: two screens asking the same question of the same
        // product must not get two answers.
        $off = BranchSoldOut::query()
            ->where('branch_id', $branchId)
            ->whereIn('product_id', $ids)
            ->get(['product_id', 'variant_id', 'sold_out_at']);

        $offProduct = $off->whereNull('variant_id')->keyBy('product_id');
        $offVariant = $off->whereNotNull('variant_id')->keyBy('variant_id');

        foreach ($products as $p) {
            $p->sold_out = $offProduct->has($p->id);
            $p->sold_out_at = $offProduct->get($p->id)?->sold_out_at;

            if ($p->relationLoaded('variants')) {
                foreach ($p->variants as $v) {
                    $v->sold_out_at = $offVariant->get($v->id)?->sold_out_at;
                }
            }
        }

        $overrides = BranchPrice::query()
            ->where('branch_id', $branchId)
            ->whereNull('variant_id')
            ->whereIn('product_id', $ids)
            ->pluck('price', 'product_id');
        foreach ($products as $p) {
            $p->branch_price = isset($overrides[$p->id]) ? (string) $overrides[$p->id] : null;
        }

        // Per-branch stock for each VARIANT, stamped the same way and for the
        // same reason.
        //
        // `product_variants.stock_quantity` is the tenant-wide rollup — the
        // shop's total across every branch. A till standing in one branch
        // that reads it is being told about stock it cannot sell, and the
        // offline projection already answers this question per branch
        // (PosProjection::stockAt keys "productId:variantId"). So the same
        // size read online and offline gave two different numbers, and the
        // one the size picker needs is this one.
        //
        // Additive: `branch_stock` alongside the untouched rollup, so the
        // catalog and inventory screens that legitimately want the shop-wide
        // figure keep reading what they always read. Same shape as
        // `branch_price` directly above.
        $variantStock = BranchStock::query()
            ->where('branch_id', $branchId)
            ->whereNotNull('variant_id')
            ->whereIn('product_id', $ids)
            ->pluck('quantity', 'variant_id');

        foreach ($products as $p) {
            if (! $p->relationLoaded('variants')) {
                continue;
            }
            foreach ($p->variants as $v) {
                $v->branch_stock = (float) ($variantStock[$v->id] ?? 0);
            }
        }

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
    public function import(Request $request, ImportProductsAction $action): JsonResponse
    {
        // The only upload on the platform that took ANY file type. It is read
        // as text and never stored or served, so the exposure was small — but
        // "we happen not to save it" is not the reason a rule should hold, and
        // a 4 MB binary parsed line-by-line as CSV is nobody's intention.
        $request->validate(['file' => ['required', 'file', 'mimes:csv,txt', 'max:4096']]);

        $summary = $action->execute($request->file('file')->get());

        return ApiResponse::ok(
            $summary,
            "Imported {$summary['created']} new, updated {$summary['updated']}, {$summary['failed']} failed.",
        );
    }

    /** A ready-to-fill CSV template with the supported columns + one example row. */
    /**
     * A blank catalog file, in THIS shop's own shape.
     *
     * ── The bug this replaces ───────────────────────────────────────────
     *
     * One template went to every trade: thirty-two columns and six worked
     * rows — a sugar, a Panadol, a karahi, a phone, a service — whatever the
     * shop actually sold. Meanwhile the importer refuses an item type the
     * trade may not catalog, read from `BusinessTypes::itemTypesFor()`.
     *
     * Two lists, and they disagreed. Proven against the live panel: a
     * restaurant downloaded this file and uploaded it back UNCHANGED —
     *
     *     Imported 4 new, 2 failed.
     *       row 3 -> Item type "medicine" isn't available for this business type.
     *       row 7 -> Item type "service" isn't available for this business type.
     *
     * — and the four that succeeded put Loose Sugar and a Galaxy A16 into a
     * restaurant's catalog. Both halves of that are bugs: a file we hand out
     * that we then refuse, and sample data that quietly becomes real stock.
     *
     * ── Why it is generated, not eight files ────────────────────────────
     *
     * Eight hand-written templates would drift from the validator exactly as
     * this one did. The rows come off `itemTypesFor()` — the same list the
     * importer checks against — so the template CANNOT offer a row the
     * importer will refuse. There is no second list to drift from, and a trade
     * added next year gets a correct template without anybody writing one.
     */
    public function importTemplate(TenantContext $context): StreamedResponse
    {
        $tenant = $context->get();
        $type = $tenant?->business_type;

        // Only the columns this trade has. A restaurant filling in Dosage Form
        // and Warranty Months is a restaurant being invited to make mistakes.
        $columns = ProductCsv::headersFor($type);

        // The shop's own words for a shelf and a unit, so the example reads
        // like something it might actually sell.
        // `product_categories`, NOT `categoriesFor()` — the latter returns
        // value/label pairs describing sub-trades ("Fast Food", "Bakery"),
        // which are not shelves and would read as nonsense in a Category cell.
        $shelves = $type !== null ? (BusinessTypes::get($type)['product_categories'] ?? []) : [];
        $units = $type !== null ? BusinessTypes::unitsFor($type) : [];
        $category = is_string($shelves[0] ?? null) ? $shelves[0] : 'General';
        $unit = is_string($units[0] ?? null) ? $units[0] : 'Piece';

        // ONE example per item type the shop may actually catalog. A trade that
        // sells neither goods nor labour gets a header row and nothing else,
        // which is the honest answer rather than an example it cannot use.
        $types = $type !== null
            ? BusinessTypes::itemTypesFor($type, $tenant?->moduleMap())
            : [ItemTypes::PHYSICAL];

        $samples = array_map(
            fn (string $itemType): array => ProductCsv::exampleRow($itemType, $category, $unit, $columns),
            $types,
        );

        // …and one worked SIZE, for the trades that have them, because a
        // product with sizes could not be bulk-loaded at all before this.
        if ($types !== [] && BusinessTypes::variantAttributesFor((string) $type) !== []) {
            $samples[] = ProductCsv::exampleVariantRow($category, $unit, $columns);
        }

        // Through the same helper as the export, which writes the UTF-8 BOM.
        // Hand-rolled, this file was the ONE a merchant types into — and the
        // one without the marker that makes Excel read Urdu names correctly.
        return CsvExport::stream('products-import-template.csv', array_values($columns), $samples);
    }

    /**
     * Export the item catalog to CSV. Honours the same filters as index() so a
     * merchant can "export what I'm looking at", and emits the SAME columns as
     * the import template — an exported file round-trips straight back through
     * /products/import for bulk edits.
     */
    public function export(Request $request): StreamedResponse
    {
        // Title Case headers a merchant can read. The importer lowercases and
        // swaps spaces for underscores, so this round-trips unchanged.
        $header = ProductCsv::headerRow();

        $rows = Product::query()
            ->with(['category:id,name', 'taxGroup:id,name', 'barcodes:id,product_id,variant_id,barcode'])
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
                    ->where(function ($w): void {
                        // No variants → the product's own stock is the truth.
                        $w->where(function ($x): void {
                            $x->whereDoesntHave('variants')
                                ->whereColumn('stock_quantity', '<=', 'low_stock_threshold');
                        })
                            // Has variants → stock lives on the variants; the
                            // parent stock_quantity is orphaned, so compare the
                            // live variant sum against the threshold instead.
                            ->orWhere(function ($x): void {
                                $x->whereHas('variants')
                                    ->whereRaw('(select coalesce(sum(pv.stock_quantity), 0) from product_variants pv where pv.product_id = products.id and pv.deleted_at is null) <= low_stock_threshold');
                            });
                    });
            })
            ->orderBy('name')
            ->get()
            ->map(fn (Product $p) => [
                $p->name,
                $p->item_type,
                $p->sku,
                // Blank, and it has to BE here: these rows are positional, so
                // a header with no cell under it shifts every column after it
                // — an export whose Barcode column holds barcodes under the
                // wrong heading, which re-imports as the wrong field.
                // Products have no parent; only sizes do.
                '',
                $p->barcode,
                $p->barcodes->pluck('barcode')->reject(fn ($b) => $b === $p->barcode)->implode('|'),
                $p->plu_code,
                $p->brand,
                $p->category?->name,
                $p->unit,
                $p->sold_by,
                $p->price,
                $p->cost,
                $p->wholesale_price,
                $p->discount_price,
                $p->tax_rate,
                $p->taxGroup?->name,
                $p->stock_quantity,
                $p->low_stock_threshold,
                $p->min_order_qty,
                $p->track_inventory ? 1 : 0,
                $p->generic_name,
                $p->strength,
                $p->dosage_form,
                $p->drug_schedule,
                $p->requires_prescription ? 1 : 0,
                $p->kitchen_station,
                $p->tracks_serial ? 1 : 0,
                $p->warranty_months,
                $p->duration_minutes,
                $p->description,
                $p->is_active ? 1 : 0,
                $p->visible_in_marketplace ? 1 : 0,
            ])
            ->all();

        return CsvExport::stream('products-'.now()->format('Y-m-d').'.csv', $header, $rows);
    }

    public function show(string $id): JsonResponse
    {
        /** @var Product $product */
        $product = Product::query()
            // `cost` on the ingredient, deliberately: a dish's food cost is
            // computed from these and the selection used to stop at the name,
            // so the figure could not be produced from the row it was already
            // loading.
            ->with(['category', 'variants', 'images', 'collections', 'modifierGroups.options', 'barcodes:id,product_id,variant_id,barcode', 'units', 'comboItems.component:id,name', 'recipeItems.ingredient:id,name,cost'])
            ->findOrFail($id);

        return ApiResponse::ok(array_merge($product->toArray(), [
            // What one portion costs to make. Null where the dish has no
            // recipe, or where an ingredient under it has no cost — never a
            // partial sum, which would read as a smaller cost rather than as
            // an unknown one and make the kitchen underprice.
            'recipe_cost' => RecipeCost::forDish($product),
            // The half that makes it actionable: "cannot cost this dish" is a
            // complaint, "Onions and Cooking oil have no cost" is a job.
            'recipe_cost_missing' => RecipeCost::missingCosts($product),
        ]));
    }

    /**
     * Cross-branch availability — this product's on-hand at every active branch
     * (0 where a branch holds none). Powers the "check other branches" lookup.
     */
    public function branchStock(string $id): JsonResponse
    {
        /** @var Product $product */
        $product = Product::query()->findOrFail($id);

        $rows = Branch::query()
            ->where('is_active', true)
            ->orderByDesc('is_default')
            ->orderBy('name')
            ->get(['id', 'name', 'is_default'])
            ->map(fn ($b) => [
                'branch_id' => $b->id,
                'branch' => $b->name,
                'is_default' => $b->is_default,
                'quantity' => (float) BranchStock::query()
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
    public function serials(string $id, Request $request): JsonResponse
    {
        $product = Product::query()->findOrFail($id);
        $status = $request->query('status', 'in_stock');

        $rows = ProductSerial::query()
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

        $overrides = BranchPrice::query()
            ->where('product_id', $product->id)
            ->whereNull('variant_id')
            ->pluck('price', 'branch_id');

        $branches = Branch::query()
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
    public function setBranchPrices(SetBranchPricesRequest $request, string $id): JsonResponse
    {
        /** @var Product $product */
        $product = Product::query()->findOrFail($id);
        $tenantId = $product->tenant_id;

        foreach ($request->validated('prices') as $row) {
            if (($row['price'] ?? null) === null) {
                BranchPrice::query()
                    ->where('branch_id', $row['branch_id'])
                    ->where('product_id', $product->id)
                    ->whereNull('variant_id')
                    ->delete();

                continue;
            }

            BranchPrice::query()->updateOrCreate(
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
