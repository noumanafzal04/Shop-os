<?php

namespace App\Actions\Catalog;

use App\Exceptions\DomainException;
use App\Models\AuditLog;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\ProductUnit;
use App\Models\TaxGroup;
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
    /**
     * Every column a merchant's file may carry. A header outside this list is
     * dropped in silence, so a trade whose fields are missing here cannot bulk-
     * load its catalog at all — it can only load the half of each item that
     * every shop shares.
     *
     * The second block is that missing half. `generic_name` and
     * `requires_prescription` shipped from the start while `strength`,
     * `dosage_form` and `drug_schedule` did not, which made a medical store's
     * import look supported and then arrive incomplete. Same for a restaurant's
     * `kitchen_station` (without it every dish routes to one printer) and a
     * phone shop's `tracks_serial` (without it 500 handsets import with no way
     * to look up a warranty).
     */
    private const COLUMNS = [
        'name', 'item_type', 'sku', 'barcode', 'barcodes', 'plu_code', 'brand', 'generic_name',
        'requires_prescription', 'category', 'unit', 'sold_by', 'price', 'cost',
        'discount_price', 'tax_rate', 'stock_quantity', 'low_stock_threshold',
        'min_order_qty', 'is_active', 'visible_in_marketplace',
        // Trade-specific, and general fields the catalog has always held.
        'description', 'strength', 'dosage_form', 'drug_schedule', 'kitchen_station',
        'tracks_serial', 'warranty_months', 'wholesale_price', 'duration_minutes',
        'track_inventory', 'tax_group',
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

        /**
         * ONE row in the trail for the import, not one per product.
         *
         * A product's price is audited, and rightly — it is the number a shop
         * changes most often and the only record of the old one used to be the
         * screen it was typed over. But an import is ONE act by one person, and
         * a supplier's price list touching 340 items would file 340 rows a
         * second apart and push every hand-made change off the first page.
         * That is the failure the whole `auditOnly` allowlist exists to avoid.
         *
         * So the rows are suppressed and the OPERATION is recorded, below.
         * Suppressing without recording would be making a write quiet, which is
         * a different and much worse thing.
         */
        $before = Product::query()->count();

        Product::withoutAuditing(function () use ($rows, &$summary): void {
            $this->importRows($rows, $summary);
        });

        $this->recordTheImport($summary, $before);

        return $summary;
    }

    /** @param array<int, array<string, string>> $rows */
    private function importRows(array $rows, array &$summary): void
    {
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
    }

    /**
     * The import itself, as one line somebody can read.
     *
     * `new_values` carries the counts rather than a product's fields, because
     * the thing that happened is the import — "340 items updated by Asif at
     * 11:04" is the sentence a shopkeeper needs when a shelf price is suddenly
     * wrong and nobody remembers touching it.
     */
    private function recordTheImport(array $summary, int $before): void
    {
        if ($summary['created'] === 0 && $summary['updated'] === 0) {
            return;
        }

        AuditLog::query()->create([
            'user_id' => auth()->id(),
            'tenant_id' => $this->context->id(),
            'event' => 'imported',
            'auditable_type' => Product::class,
            'auditable_id' => null,
            'old_values' => ['products' => $before],
            'new_values' => [
                'created' => $summary['created'],
                'updated' => $summary['updated'],
                'failed' => $summary['failed'],
            ],
            'ip_address' => request()?->ip(),
        ]);
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
            'description' => ['nullable', 'string', 'max:5000'],
            'strength' => ['nullable', 'string', 'max:60'],
            'dosage_form' => ['nullable', 'string', 'max:40'],
            'drug_schedule' => ['nullable', 'string', 'max:20'],
            'kitchen_station' => ['nullable', 'string', 'max:60'],
            'warranty_months' => ['nullable', 'integer', 'min:0', 'max:600'],
            'wholesale_price' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            'duration_minutes' => ['nullable', 'integer', 'min:1', 'max:1440'],
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

            // Tax group by NAME, and only a name that already exists. Unlike a
            // category, a tax group is a rate: inventing "GST 17%" from a typo
            // would price a whole import wrong and look deliberate. An unknown
            // name is left off, so the item falls back to the shop's default
            // rate rather than a rate nobody chose.
            if (! empty($data['tax_group'])) {
                $data['tax_group_id'] = TaxGroup::query()
                    ->where('name', $data['tax_group'])
                    ->value('id');
            }
            unset($data['tax_group']);

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
            'description' => $get('description'),
            'strength' => $get('strength'),
            'dosage_form' => $get('dosage_form'),
            'drug_schedule' => $get('drug_schedule'),
            'kitchen_station' => $get('kitchen_station'),
            'tax_group' => $get('tax_group'),
            'warranty_months' => $get('warranty_months'),
            'wholesale_price' => $get('wholesale_price'),
            'duration_minutes' => $get('duration_minutes'),
            'is_active' => $bool('is_active', true),
            'visible_in_marketplace' => $bool('visible_in_marketplace', true),
        ];

        // These two default to the ITEM TYPE's own answer, so a blank column
        // leaves them alone. Defaulting either to false would quietly turn
        // stock tracking off across a whole catalog on a re-import.
        if ($get('tracks_serial') !== null) {
            $data['tracks_serial'] = $bool('tracks_serial', false);
        }
        if ($get('track_inventory') !== null) {
            $data['track_inventory'] = $bool('track_inventory', true);
        }

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
