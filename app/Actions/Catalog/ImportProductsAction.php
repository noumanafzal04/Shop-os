<?php

namespace App\Actions\Catalog;

use App\Exceptions\DomainException;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\ProductUnit;
use App\Services\InventoryService;
use App\Support\BusinessTypes;
use App\Support\ItemTypes;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/**
 * Bulk product import from a CSV — the fast way to load a shop's whole catalog
 * before launch. Each row is validated and upserted INDEPENDENTLY (its own
 * transaction), so one bad row never rolls back the good ones; every failure
 * is reported back with its line number and reason.
 *
 * Upsert key: SKU. A row whose SKU already exists in the shop UPDATES that
 * product; otherwise a new one is created. Category is matched by name
 * (created if missing). Header names are case/spacing-insensitive.
 */
class ImportProductsAction
{
    private const MAX_ROWS = 2000;

    /** Accepted headers → internal field. */
    private const COLUMNS = [
        'name', 'item_type', 'sku', 'barcode', 'barcodes', 'plu_code', 'brand', 'generic_name',
        'requires_prescription', 'category', 'unit', 'sold_by', 'price', 'cost',
        'discount_price', 'tax_rate', 'stock_quantity', 'low_stock_threshold',
        'min_order_qty', 'is_active', 'visible_in_marketplace',
    ];

    public function __construct(
        private readonly CreateProductAction $create,
        private readonly UpdateProductAction $update,
        private readonly InventoryService $inventory,
        private readonly TenantContext $context,
    ) {}

    /** Barcodes / PLUs already used by EARLIER rows of this same file. */
    private array $seenBarcodes = [];

    private array $seenPlus = [];

    /**
     * @return array{total:int, created:int, updated:int, failed:int, errors:array<array{row:int, messages:string[]}>}
     */
    public function execute(string $csv): array
    {
        $rows = $this->parse($csv);

        $this->seenBarcodes = [];
        $this->seenPlus = [];

        $summary = ['total' => 0, 'created' => 0, 'updated' => 0, 'failed' => 0, 'errors' => []];

        foreach ($rows as $i => $row) {
            // +2 = 1 for the header line, 1 for 1-based line numbers a user sees.
            $lineNo = $i + 2;
            $summary['total']++;

            try {
                $result = $this->importRow($row);
                $summary[$result]++; // 'created' | 'updated'
            } catch (DomainException $e) {
                $summary['failed']++;
                $summary['errors'][] = ['row' => $lineNo, 'messages' => [$e->getMessage()]];
            } catch (RowValidationException $e) {
                $summary['failed']++;
                $summary['errors'][] = ['row' => $lineNo, 'messages' => $e->messages];
            } catch (QueryException $e) {
                // A DB constraint (e.g. a unique index racing this import) must
                // fail THIS row with a readable message — never 500 the whole
                // file and strand the rows after it.
                $summary['failed']++;
                $summary['errors'][] = ['row' => $lineNo, 'messages' => [
                    (string) $e->getCode() === '23000'
                        ? 'A unique value in this row (barcode / PLU / SKU) is already in use.'
                        : 'Database error while saving this row.',
                ]];
            }
        }

        return $summary;
    }

    /** @return 'created'|'updated' */
    private function importRow(array $row): string
    {
        $data = $this->normalize($row);

        $validator = Validator::make($data, [
            'name' => ['required', 'string', 'max:255'],
            'item_type' => ['required', 'in:'.implode(',', ItemTypes::codes())],
            'price' => ['required', 'numeric', 'min:0', 'max:99999999'],
            'sku' => ['nullable', 'string', 'max:64'],
            'barcode' => ['nullable', 'string', 'max:191'],
            'plu_code' => ['nullable', 'regex:/^\d{1,7}$/'],
            'sold_by' => ['nullable', 'in:unit,weight'],
            'cost' => ['nullable', 'numeric', 'min:0'],
            'discount_price' => ['nullable', 'numeric', 'min:0'],
            'tax_rate' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'stock_quantity' => ['nullable', 'numeric', 'min:0'],
            'min_order_qty' => ['nullable', 'numeric', 'min:0.001'],
        ]);

        if ($validator->fails()) {
            throw new RowValidationException($validator->errors()->all());
        }

        // The business type constrains what a shop may catalog — same rule the
        // HTTP form enforces (a mart can't import medicines), read off the same
        // source: the tenant's own module map, not the type's template.
        $tenant = $this->context->get();
        $businessType = $tenant?->business_type;
        if ($businessType !== null
            && ! in_array($data['item_type'], BusinessTypes::itemTypesFor($businessType, $tenant->moduleMap()), true)) {
            throw new RowValidationException(["Item type \"{$data['item_type']}\" isn't available for this business type."]);
        }

        // Upsert by SKU within the shop.
        $existing = ! empty($data['sku'])
            ? Product::query()->where('sku', $data['sku'])->first()
            : null;

        $this->guardUniqueCodes($data, $existing);

        return DB::transaction(function () use ($data, $existing): string {
            // Resolve category by name (create if missing).
            if (! empty($data['category'])) {
                $data['category_id'] = Category::query()->firstOrCreate(['name' => $data['category']])->id;
            }
            unset($data['category']);

            if ($existing !== null) {
                // Stock is NEVER mass-assigned on update — a recount goes
                // through the audited inventory path (lock, negative guard,
                // stock-movement row), exactly like the Adjust Stock screen.
                $newStock = $data['stock_quantity'] ?? null;
                unset($data['stock_quantity']);

                // item_type / type / track_inventory are IMMUTABLE after
                // creation (UpdateProductRequest prohibits them). normalize()
                // always fills item_type (defaulting a missing column to
                // physical_product), so a bare re-import would silently flip an
                // existing medicine/deal to physical_product — stranding its
                // stock and mis-routing restore paths. Strip them on update.
                unset($data['item_type'], $data['type'], $data['track_inventory']);

                $this->update->execute($existing, $data);

                if ($newStock !== null && (float) $newStock !== (float) $existing->stock_quantity) {
                    $this->inventory->adjust([
                        'product_id' => $existing->id,
                        'type' => 'set',
                        'new_quantity' => (float) $newStock,
                        'reason' => 'CSV import recount',
                    ]);
                }

                return 'updated';
            }

            $this->create->execute($data);

            return 'created';
        });
    }

    /**
     * Duplicate barcode / PLU protection the DB can't fully give us (the
     * primary barcode column has no unique index): checked against earlier
     * rows of this file AND everything already in the shop — primary barcodes,
     * alternate barcodes, and pack barcodes. Violations fail the ROW.
     */
    private function guardUniqueCodes(array $data, ?Product $existing): void
    {
        $errors = [];

        if (! empty($data['barcode'])) {
            $code = $data['barcode'];
            $inShop = Product::query()->where('barcode', $code)
                ->when($existing !== null, fn ($q) => $q->whereKeyNot($existing->id))
                ->exists()
                || ProductBarcode::query()->where('barcode', $code)
                    ->when($existing !== null, fn ($q) => $q->where('product_id', '!=', $existing->id))
                    ->exists()
                || ProductUnit::query()->where('barcode', $code)
                    ->when($existing !== null, fn ($q) => $q->where('product_id', '!=', $existing->id))
                    ->exists();

            if (isset($this->seenBarcodes[$code]) || $inShop) {
                $errors[] = "Barcode {$code} is already in use.";
            }
        }

        if (! empty($data['plu_code'])) {
            $plu = $data['plu_code'];
            $inShop = Product::query()->where('plu_code', $plu)
                ->when($existing !== null, fn ($q) => $q->whereKeyNot($existing->id))
                ->exists();

            if (isset($this->seenPlus[$plu]) || $inShop) {
                $errors[] = "PLU {$plu} is already in use.";
            }
        }

        if ($errors !== []) {
            throw new RowValidationException($errors);
        }

        // Row is clear — claim its codes so a later duplicate row fails.
        if (! empty($data['barcode'])) {
            $this->seenBarcodes[$data['barcode']] = true;
        }
        if (! empty($data['plu_code'])) {
            $this->seenPlus[$data['plu_code']] = true;
        }
    }

    /** Map a raw CSV row to a clean product-data array with typed values. */
    private function normalize(array $row): array
    {
        $get = fn (string $k) => isset($row[$k]) && trim((string) $row[$k]) !== '' ? trim((string) $row[$k]) : null;
        $bool = fn (string $k, bool $default) => $get($k) !== null
            ? in_array(strtolower($get($k)), ['1', 'true', 'yes', 'y'], true)
            : $default;

        $data = [
            'name' => $get('name'),
            'item_type' => $get('item_type') ?? ItemTypes::PHYSICAL,
            'sku' => $get('sku'),
            'barcode' => $get('barcode'),
            'plu_code' => $get('plu_code'),
            'brand' => $get('brand'),
            'generic_name' => $get('generic_name'),
            'category' => $get('category'),
            'unit' => $get('unit'),
            'sold_by' => $get('sold_by') ? strtolower($get('sold_by')) : null,
            'price' => $get('price'),
            'cost' => $get('cost'),
            'discount_price' => $get('discount_price'),
            'tax_rate' => $get('tax_rate'),
            'stock_quantity' => $get('stock_quantity'),
            'low_stock_threshold' => $get('low_stock_threshold'),
            'min_order_qty' => $get('min_order_qty'),
            'requires_prescription' => $bool('requires_prescription', false),
            'is_active' => $bool('is_active', true),
            'visible_in_marketplace' => $bool('visible_in_marketplace', true),
        ];

        // Multiple barcodes: pipe-separated in one cell.
        if (($raw = $get('barcodes')) !== null) {
            $data['barcodes'] = collect(explode('|', $raw))->map(fn ($b) => trim($b))->filter()->values()->all();
        }

        // Drop nulls so the actions apply their own defaults.
        return array_filter($data, fn ($v) => $v !== null);
    }

    /** @return array<int, array<string, string>> header-keyed rows */
    private function parse(string $csv): array
    {
        $csv = preg_replace('/^\xEF\xBB\xBF/', '', $csv); // strip UTF-8 BOM
        $lines = preg_split('/\r\n|\r|\n/', trim($csv));

        if ($lines === false || count($lines) < 2) {
            throw DomainException::unprocessable('The CSV has no data rows.', 'IMPORT_EMPTY');
        }

        $header = array_map(
            fn ($h) => str_replace(' ', '_', strtolower(trim($h))),
            str_getcsv(array_shift($lines)),
        );

        if (! in_array('name', $header, true) || ! in_array('price', $header, true)) {
            throw DomainException::unprocessable(
                'The CSV must have at least "name" and "price" columns.',
                'IMPORT_BAD_HEADER',
            );
        }

        $rows = [];
        foreach ($lines as $line) {
            if (trim($line) === '') {
                continue;
            }
            $cells = str_getcsv($line);
            $row = [];
            foreach ($header as $col => $key) {
                if (in_array($key, self::COLUMNS, true)) {
                    $row[$key] = $cells[$col] ?? null;
                }
            }
            $rows[] = $row;

            if (count($rows) > self::MAX_ROWS) {
                throw DomainException::unprocessable(
                    'Too many rows — import at most '.self::MAX_ROWS.' products per file.',
                    'IMPORT_TOO_LARGE',
                );
            }
        }

        return $rows;
    }
}

/** Internal: per-row validation failure, collected rather than thrown to the client. */
class RowValidationException extends \Exception
{
    /** @param string[] $messages */
    public function __construct(public array $messages)
    {
        parent::__construct(implode(' ', $messages));
    }
}
