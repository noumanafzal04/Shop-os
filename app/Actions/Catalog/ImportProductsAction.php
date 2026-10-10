<?php

namespace App\Actions\Catalog;

use App\Exceptions\DomainException;
use App\Models\AuditLog;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\ProductUnit;
use App\Models\ProductVariant;
use App\Models\TaxGroup;
use App\Models\Tenant;
use App\Services\InventoryService;
use App\Support\Import\CategoryPaths;
use App\Support\Import\Cell;
use App\Support\ItemTypes;
use App\Support\ProductCsv;
use App\Support\Spreadsheet\Tabular;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/**
 * A shop's catalogue, from a sheet — Excel or CSV, any trade.
 *
 * ── ONE ENGINE ──────────────────────────────────────────────────────────
 *
 * Every shop's file comes through here. What differs between a chemist and a
 * salon is which COLUMNS the shop is given and which KIND of item a row is
 * when it does not say — both asked of the shop itself (`ProductCsv::
 * columnsFor`, its trade and its modules), never written out per trade.
 *
 * ── What a row is ───────────────────────────────────────────────────────
 *
 *   a PRODUCT            — matched by SKU: an existing SKU is updated, a new
 *                          one (or none) is created
 *   a SIZE of a product  — Parent SKU filled in
 *   a PACK of a product  — Parent SKU and Pack Size filled in: a carton of 24
 *
 * Each row stands alone: one bad row never takes the good ones with it, and
 * every refusal is said against the row's number IN THE SHEET, with the row
 * itself handed back so it can be corrected and sent again.
 *
 * ── The three rules that came from real files ───────────────────────────
 *
 * A BLANK CELL MEANS "LEAVE IT". A supplier's price list has three columns.
 * Updating from it must change three things — it used to switch off the
 * prescription rule on every controlled drug, put discontinued items back on
 * sale and publish hidden ones, because a missing column was read as "no".
 *
 * A ROW THAT DOES NOT SAY WHAT IT IS, IS WHAT THE SHOP SELLS. A restaurant's
 * rows are dishes and a chemist's are medicines. They were all "physical
 * product": refused outright for a salon, and quietly wrong for the rest.
 *
 * NOTHING IS INVENTED. A category the shop does not have is asked about, not
 * created from a typo; a tax group it does not have is refused, not replaced
 * by the default rate; a barcode Excel has rounded is said, not stored.
 *
 * ── Preview ─────────────────────────────────────────────────────────────
 *
 * `dry_run` runs the SAME code inside a transaction and rolls it back, so what
 * the preview says is what the import does. There is no second, lighter
 * validator to drift from this one.
 */
class ImportProductsAction
{
    public const MAX_ROWS = 2000;

    private const MONEY = ['price', 'cost', 'discount_price', 'wholesale_price'];

    private const NUMBERS = ['tax_rate', 'stock_quantity', 'low_stock_threshold', 'min_order_qty', 'pack_size'];

    private const WHOLE = ['warranty_months', 'duration_minutes'];

    private const YES_NO = ['requires_prescription', 'is_active', 'visible_in_marketplace', 'tracks_serial', 'track_inventory'];

    private const CODES = ['sku', 'barcode', 'plu_code', 'parent_sku'];

    private const TEXT = [
        'name', 'brand', 'unit', 'description', 'generic_name', 'strength', 'dosage_form',
        'drug_schedule', 'kitchen_station', 'batch_number',
    ];

    /** Columns the import adds to a file of rows it is handing back. Never read. */
    private const OUR_OWN = ['_import_status', '_error_message'];

    public function __construct(
        private readonly CreateProductAction $create,
        private readonly UpdateProductAction $update,
        private readonly SyncProductVariantsAction $variants,
        private readonly SyncProductUnitsAction $units,
        private readonly InventoryService $inventory,
        private readonly TenantContext $context,
    ) {}

    private bool $dry = false;

    private ?Tenant $tenant = null;

    /** @var string[] the kinds of item this shop's file may bring in */
    private array $kinds = [];

    private CategoryPaths $categories;

    /** @var array<string, array{action: string, id?: ?string}> what the person chose, by category as compared */
    private array $decisions = [];

    /** @var array<string, array{name: string, rows: int, suggestion: ?array{id: string, path: string}}> */
    private array $unknown = [];

    /**
     * Headings the person has explained: "Tukri" is Category, "Notes" is nothing.
     *
     * @var array<string, string> heading, as compared => field ('' to leave it out)
     */
    private array $mapping = [];

    /**
     * What each field is CALLED in this file — "Selling Price", not "Price".
     * A refusal names the column the person will go and look for.
     *
     * @var array<string, string> field => the file's own heading
     */
    private array $headings = [];

    /** New rows with no SKU whose name the shop already has — they will be added AGAIN. */
    private int $sameName = 0;

    /** @var array<string, mixed> */
    private array $out = [];

    /**
     * @param  array{dry_run?: bool, categories?: array<string, array{action?: string, id?: ?string}>, mapping?: array<string, ?string>}  $options
     * @return array<string, mixed>
     */
    public function execute(string $bytes, array $options = []): array
    {
        $sheet = Tabular::read($bytes, self::MAX_ROWS);

        if ($sheet['rows'] === []) {
            throw DomainException::unprocessable('The file has no rows under its headings.', 'IMPORT_EMPTY');
        }
        if (count($sheet['rows']) > self::MAX_ROWS) {
            throw DomainException::unprocessable(
                'This file has more than '.number_format(self::MAX_ROWS).' rows. Split it into files of up to '.number_format(self::MAX_ROWS).' — each one is checked and brought in on its own.',
                'IMPORT_TOO_LARGE',
            );
        }

        $this->tenant = $this->context->get();
        $this->dry = (bool) ($options['dry_run'] ?? false);
        $this->kinds = ProductCsv::importableTypes($this->tenant);
        $this->unknown = [];
        $this->sameName = 0;
        $this->decisions = [];
        $this->mapping = [];
        foreach ($options['mapping'] ?? [] as $heading => $field) {
            $this->mapping[mb_strtolower(trim((string) $heading))] = (string) $field;
        }
        foreach ($options['categories'] ?? [] as $typed => $choice) {
            $this->decisions[CategoryPaths::key((string) $typed)] = [
                'action' => (string) ($choice['action'] ?? ''),
                'id' => $choice['id'] ?? null,
            ];
        }

        [$columns, $ignored] = $this->columns($sheet['header']);
        $this->headings = [];
        foreach ($columns as $index => $field) {
            $this->headings[$field] = $sheet['header'][$index];
        }

        // Something to know a row by. A price list keyed on SKU has no Name
        // column and is still a file somebody means.
        if (! in_array('name', $columns, true) && ! in_array('sku', $columns, true)) {
            throw DomainException::unprocessable(
                'The file needs a "Name" column — or a "SKU" column, to change items you already have. The first row must be the headings.',
                'IMPORT_BAD_HEADER',
            );
        }

        $rows = [];
        foreach ($sheet['rows'] as $line => $cells) {
            $read = [];
            foreach ($columns as $index => $field) {
                $read[$field] = trim((string) ($cells[$index] ?? ''));
            }

            $raw = [];
            foreach ($sheet['header'] as $index => $heading) {
                if ($heading !== '' && ! in_array(mb_strtolower($heading), self::OUR_OWN, true)) {
                    $raw[$heading] = (string) ($cells[$index] ?? '');
                }
            }

            $rows[$line] = ['line' => $line, 'cells' => $read, 'raw' => $raw];
        }

        $this->out = [
            'total' => 0, 'created' => 0, 'updated' => 0, 'failed' => 0, 'skipped' => 0, 'waiting' => 0,
            'errors' => [], 'failed_rows' => [],
            // Rows that WERE taken, with something worth knowing about them:
            // a price below cost, a stock figure for an item that counts none.
            'warnings' => [],
        ];

        $before = Product::query()->count();

        if ($this->dry) {
            // The real thing, undone. See the note at the top.
            DB::beginTransaction();
            try {
                $this->run($rows);
            } finally {
                DB::rollBack();
            }
        } else {
            $this->run($rows);
            $this->recordTheImport($before);
        }

        return $this->out + [
            'dry_run' => $this->dry,
            'kind' => $sheet['kind'],
            'headers' => array_values(array_filter(
                $sheet['header'],
                fn (string $h): bool => $h !== '' && ! in_array(mb_strtolower($h), self::OUR_OWN, true),
            )),
            'ignored_columns' => $ignored,
            'unknown_categories' => array_values($this->unknown),
            // What a column may be said to be, for the ones this import did
            // not recognise — the shop's own columns, by the name on the sheet.
            'fields' => ProductCsv::columnsFor($this->tenant),
            'same_name' => $this->sameName,
        ];
    }

    /**
     * Which column of the file is which field — and which are left out, said.
     *
     * @param  array<int, string>  $header
     * @return array{0: array<int, string>, 1: array<int, array{header: string, reason: string, unknown: bool}>}
     */
    private function columns(array $header): array
    {
        $columns = [];
        $ignored = [];

        foreach ($header as $index => $heading) {
            if ($heading === '' || in_array(mb_strtolower($heading), self::OUR_OWN, true)) {
                continue;
            }

            /**
             * A FILE FROM ANOTHER SYSTEM names its columns its own way. The
             * common names are known (`ProductCsv::fieldFor`); for the rest the
             * person says which of ours each one is, once, on the preview —
             * and that answer comes back here. Their word beats our guess.
             */
            $said = $this->mapping[mb_strtolower($heading)] ?? null;
            if ($said === '') {
                $ignored[] = ['header' => $heading, 'reason' => 'you chose to leave it out', 'unknown' => false];

                continue;
            }

            $field = $said !== null && isset(ProductCsv::HEADERS[$said]) ? $said : ProductCsv::fieldFor($heading);
            if ($field === null) {
                $ignored[] = ['header' => $heading, 'reason' => 'it is not a column this import knows', 'unknown' => true];

                continue;
            }
            if (in_array($field, $columns, true)) {
                $ignored[] = ['header' => $heading, 'reason' => 'another column in the file already says this', 'unknown' => false];

                continue;
            }

            // A column this shop is not given is not refused — it is left out,
            // and the shop is told. Stock for a shop that counts none, a
            // barcode for a shop with no till.
            $why = $this->tenant !== null && $this->tenant->business_type !== null
                ? ProductCsv::whyNot($field, $this->tenant)
                : null;
            // Item Type is read even where it is not handed out: a file that
            // says "Service" on every row of a salon's list is right, not extra.
            if ($why !== null && $field !== 'item_type') {
                $ignored[] = ['header' => $heading, 'reason' => $why, 'unknown' => false];

                continue;
            }

            $columns[$index] = $field;
        }

        return [$columns, $ignored];
    }

    /** @param  array<int, array{line: int, cells: array<string, string>, raw: array<string, string>}>  $rows */
    private function run(array $rows): void
    {
        $this->categories = CategoryPaths::ofThisShop();

        /**
         * TWO PASSES, so the order of the file does not matter.
         *
         * A size or a pack names its parent by SKU, and a sheet sorted by price
         * — or by name, which puts "Large" above "T-Shirt" — would otherwise
         * send it in before the product it belongs to.
         */
        $products = array_filter($rows, fn (array $r): bool => ($r['cells']['parent_sku'] ?? '') === '');
        $children = array_filter($rows, fn (array $r): bool => ($r['cells']['parent_sku'] ?? '') !== '');
        $packs = array_filter($children, fn (array $r): bool => ($r['cells']['pack_size'] ?? '') !== '');
        $sizes = array_filter($children, fn (array $r): bool => ($r['cells']['pack_size'] ?? '') === '');

        /**
         * ONE row in the trail for the import, not one per product — see
         * recordTheImport. Suppressing without recording would be making a
         * write quiet, which is a different and much worse thing.
         */
        Product::withoutAuditing(function () use ($products, $sizes, $packs): void {
            foreach ($products as $row) {
                $this->attempt($row, fn (): string => $this->product($row));
            }
            $this->sizes($sizes);
            $this->packs($packs);
        });
    }

    /**
     * One row, and whatever became of it.
     *
     * @param  array{line: int, cells: array<string, string>, raw: array<string, string>}  $row
     * @param  callable(): string  $do  answers 'created' | 'updated' | 'skipped' | 'waiting'
     */
    private function attempt(array $row, callable $do): void
    {
        $this->out['total']++;

        try {
            $outcome = $do();
            $this->out[$outcome]++;

            if ($outcome === 'waiting') {
                $this->handBack($row, 'waiting', ['Its category is not in your shop yet — choose what to do with it.']);
            }
        } catch (RowRefused $e) {
            $this->refuse($row, $e->messages);
        } catch (DomainException $e) {
            $this->refuse($row, [$e->getMessage()]);
        } catch (QueryException $e) {
            // A constraint racing this import fails THIS row, readably — it
            // must never 500 the file and strand the rows after it.
            $this->refuse($row, [
                (string) $e->getCode() === '23000'
                    ? 'A barcode, PLU or SKU in this row is already in use.'
                    : 'This row could not be saved.',
            ]);
        }
    }

    /**
     * @param  array{line: int, cells: array<string, string>, raw: array<string, string>}  $row
     * @param  string[]  $messages
     */
    private function refuse(array $row, array $messages): void
    {
        $this->out['failed']++;
        $this->out['errors'][] = ['row' => $row['line'], 'messages' => $messages];
        $this->handBack($row, 'failed', $messages);
    }

    /** What a field is called in THIS file; our own name for it where the file has no such column. */
    private function called(string $field): string
    {
        return $this->headings[$field] ?? (ProductCsv::HEADERS[$field] ?? $field);
    }

    /**
     * @param  array{line: int, cells: array<string, string>, raw: array<string, string>}  $row
     * @param  string[]  $messages
     */
    private function note(array $row, array $messages): void
    {
        if ($messages !== []) {
            $this->out['warnings'][] = ['row' => $row['line'], 'messages' => array_values($messages)];
        }
    }

    /**
     * The row as it was sent, with what was wrong with it — so it can be put
     * right in the sheet and sent again, alone.
     *
     * @param  array{line: int, cells: array<string, string>, raw: array<string, string>}  $row
     * @param  string[]  $messages
     */
    private function handBack(array $row, string $status, array $messages): void
    {
        $this->out['failed_rows'][] = [
            'row' => $row['line'],
            'status' => $status,
            'messages' => $messages,
            'cells' => $row['raw'],
        ];
    }

    // ── a product ────────────────────────────────────────────────────

    /**
     * @param  array{line: int, cells: array<string, string>, raw: array<string, string>}  $row
     * @return 'created'|'updated'|'skipped'|'waiting'
     */
    private function product(array $row): string
    {
        $cells = $row['cells'];
        [$data, $errors] = $this->read($cells);

        $existing = isset($data['sku']) ? Product::query()->where('sku', $data['sku'])->first() : null;
        $creating = $existing === null;

        if ($creating) {
            [$kind, $why] = $this->kindOf($cells['item_type'] ?? '');
            if ($why !== null) {
                $errors[] = $why;
            }
            $data['item_type'] = $kind;

            // "Missing" is a cell with nothing in it. A cell that could not be
            // READ has already been said, and is not also missing.
            if (! isset($data['name']) && ($cells['name'] ?? '') === '') {
                $errors[] = isset($data['sku'])
                    ? "No item in your shop has the SKU \"{$data['sku']}\", and a new one needs a Name."
                    : $this->called('name').' is missing.';
            }
            if (! isset($data['price']) && ($cells['price'] ?? '') === '') {
                $errors[] = $this->called('price').' is missing.';
            }
        }

        array_push($errors, ...$this->rules($data));

        $category = null;
        if (($cells['category'] ?? '') !== '') {
            $category = $this->category($cells['category']);
            if (isset($category['error'])) {
                $errors[] = $category['error'];
            }
        }

        if (($cells['tax_group'] ?? '') !== '') {
            $group = TaxGroup::query()->whereRaw('LOWER(name) = ?', [mb_strtolower($cells['tax_group'])])->first();
            if ($group === null) {
                // A category is a shelf; a tax group is a RATE. The item used
                // to fall back to the shop's default rate in silence, which
                // prices a whole file wrong and looks deliberate.
                $offered = TaxGroup::query()->orderBy('name')->pluck('name')->implode(', ');
                $errors[] = "Tax Group \"{$cells['tax_group']}\" is not one of yours".($offered !== '' ? " ({$offered})" : '').'. Correct it, or leave it blank for your usual rate.';
            } else {
                $data['tax_group_id'] = $group->id;
            }
        }

        // The day-one lot of a medicine must be dated — FEFO and the expired
        // fence read it. The item form has always insisted; this door did not.
        if ($creating && ($data['item_type'] ?? null) === ItemTypes::MEDICINE
            && (float) ($data['stock_quantity'] ?? 0) > 0 && ! isset($data['expiry_date'])) {
            $errors[] = 'An Expiry Date is needed for a medicine that arrives with stock. Add the date, or leave Stock Quantity blank and receive it later.';
        }

        if ($errors !== []) {
            throw new RowRefused($errors);
        }

        if ($category !== null) {
            if (($category['outcome'] ?? null) === 'skip') {
                return 'skipped';
            }
            if (($category['outcome'] ?? null) === 'waiting') {
                return 'waiting';
            }
        }

        $this->guardUniqueCodes($data, $existing);

        // No SKU to match on, and the shop already has an item called this:
        // it is added again. Often right (the first load from another system),
        // sometimes the same file sent twice — so it is COUNTED and said, and
        // left to the person, not refused.
        if ($creating && ! isset($data['sku']) && isset($data['name'])
            && Product::query()->whereRaw('LOWER(name) = ?', [mb_strtolower((string) $data['name'])])->exists()) {
            $this->sameName++;
        }

        return DB::transaction(function () use ($data, $existing, $cells, $category, $row): string {
            if ($category !== null) {
                $data['category_id'] = $category['create'] ?? false
                    ? $this->categories->create($cells['category'])
                    : $category['id'];
            }

            if (isset($data['batch_number'])) {
                $data['opening_batch_number'] = $data['batch_number'];
            }
            unset($data['batch_number'], $data['parent_sku'], $data['pack_size']);

            if ($existing === null) {
                $this->note($row, $this->create->execute($data)['warnings'] ?? []);

                return 'created';
            }

            // Stock is NEVER mass-assigned on update — a recount goes through
            // the audited inventory path, exactly like the Adjust Stock screen.
            $newStock = $data['stock_quantity'] ?? null;

            // What an item IS does not change after it is made, and the lot
            // fields belong to opening stock only.
            unset(
                $data['stock_quantity'], $data['item_type'], $data['track_inventory'],
                $data['expiry_date'], $data['opening_batch_number'],
            );

            $this->note($row, $this->update->execute($existing, $data)['warnings'] ?? []);

            if ($newStock !== null && (float) $newStock !== (float) $existing->stock_quantity) {
                if (! $existing->track_inventory) {
                    // Said, not refused: the rest of the row is good, and a
                    // refusal would throw away a price that was right.
                    $this->note($row, ["\"{$existing->name}\" does not count stock, so its Stock Quantity was left alone."]);
                } elseif (! $this->dry) {
                    // Not in a preview: a recount speaks to whoever watches stock.
                    $this->inventory->adjust([
                        'product_id' => $existing->id,
                        'type' => 'set',
                        'new_quantity' => (float) $newStock,
                        'reason' => 'Import recount',
                    ]);
                }
            }

            return 'updated';
        });
    }

    /**
     * What kind of item a new row is.
     *
     * @return array{0: string, 1: ?string} the kind, and why the row cannot be it
     */
    private function kindOf(string $typed): array
    {
        // The shop's own first kind: a dish for a restaurant, a medicine for a
        // chemist, a service for a salon.
        $usual = $this->kinds[0] ?? ItemTypes::PHYSICAL;

        if ($typed === '') {
            return [$usual, null];
        }

        $kind = Cell::itemType($typed);
        $label = fn (string $code): string => (string) (ItemTypes::all()[$code]['label'] ?? $code);

        if ($kind === null) {
            return [$usual, "\"{$typed}\" is not a kind of item. Use ".implode(' or ', array_map($label, $this->kinds)).', or leave it blank.'];
        }
        if ($kind === ItemTypes::DEAL) {
            return [$usual, 'A deal is made of the items inside it, which a row cannot say — add it on the Products screen.'];
        }
        if (! in_array($kind, $this->kinds, true)) {
            return [$usual, "Your shop does not keep items of the kind \"{$label($kind)}\"."];
        }

        return [$kind, null];
    }

    /**
     * The cells of a row as typed values — ONLY the ones that say something.
     *
     * A column that is absent, and a cell that is blank, are both left out of
     * the result, which is what makes a three-column price list change three
     * things.
     *
     * @param  array<string, string>  $cells
     * @return array{0: array<string, mixed>, 1: string[]}
     */
    private function read(array $cells): array
    {
        $data = [];
        $errors = [];
        $label = fn (string $field): string => $this->called($field);

        foreach ($cells as $field => $raw) {
            if ($raw === '') {
                continue;
            }

            if (in_array($field, self::MONEY, true) || in_array($field, self::NUMBERS, true)) {
                $n = Cell::number($raw);
                if ($n === null) {
                    $errors[] = "{$label($field)} \"{$raw}\" is not a number.";
                } else {
                    $data[$field] = $n;
                }
            } elseif (in_array($field, self::WHOLE, true)) {
                $n = Cell::number($raw);
                if ($n === null || floor($n) !== $n) {
                    $errors[] = "{$label($field)} \"{$raw}\" is not a whole number.";
                } else {
                    $data[$field] = (int) $n;
                }
            } elseif (in_array($field, self::YES_NO, true)) {
                $b = Cell::truth($raw);
                if ($b === null) {
                    $errors[] = "{$label($field)} \"{$raw}\" should be Yes or No.";
                } else {
                    $data[$field] = $b;
                }
            } elseif (in_array($field, self::CODES, true)) {
                [$code, $damaged] = Cell::code($raw);
                if ($damaged) {
                    $errors[] = "Excel has turned this {$label($field)} into {$raw} and the digits are gone. Format the column as Text, type it again, and save.";
                } elseif ($code !== null) {
                    $data[$field] = $code;
                }
            } elseif ($field === 'barcodes') {
                $codes = [];
                foreach (preg_split('/[|;]/', $raw) ?: [] as $one) {
                    [$code, $damaged] = Cell::code($one);
                    if ($damaged) {
                        $errors[] = "Excel has turned a barcode into {$one} and the digits are gone. Format the column as Text, type it again, and save.";
                    } elseif ($code !== null) {
                        $codes[] = $code;
                    }
                }
                $data['barcodes'] = $codes;
            } elseif ($field === 'sold_by') {
                $soldBy = Cell::soldBy($raw);
                if ($soldBy === null) {
                    $errors[] = "{$label('sold_by')} \"{$raw}\" should be Piece or Weight.";
                } else {
                    $data['sold_by'] = $soldBy;
                }
            } elseif ($field === 'expiry_date') {
                $date = Cell::date($raw);
                if ($date === null) {
                    $errors[] = "{$label('expiry_date')} \"{$raw}\" is not a date. Write it like 31/03/2027, or 03/2027 for the end of that month.";
                } else {
                    $data['expiry_date'] = $date;
                }
            } elseif (in_array($field, self::TEXT, true)) {
                $data[$field] = $raw;
            }
            // item_type, category and tax_group are not values to copy across:
            // each is looked up, by the caller.
        }

        return [$data, $errors];
    }

    /**
     * The limits a value has to be inside, whichever door it came through.
     *
     * @param  array<string, mixed>  $data
     * @return string[]
     */
    private function rules(array $data): array
    {
        $validator = Validator::make($data, [
            'name' => ['sometimes', 'string', 'max:255'],
            'price' => ['sometimes', 'numeric', 'min:0', 'max:99999999'],
            'sku' => ['sometimes', 'string', 'max:64'],
            'barcode' => ['sometimes', 'string', 'max:191'],
            'plu_code' => ['sometimes', 'regex:/^\d{1,7}$/'],
            'cost' => ['sometimes', 'numeric', 'min:0', 'max:99999999'],
            'discount_price' => ['sometimes', 'numeric', 'min:0', 'max:99999999'],
            'wholesale_price' => ['sometimes', 'numeric', 'min:0', 'max:99999999'],
            'tax_rate' => ['sometimes', 'numeric', 'min:0', 'max:100'],
            'stock_quantity' => ['sometimes', 'numeric', 'min:0', 'max:99999999'],
            'low_stock_threshold' => ['sometimes', 'numeric', 'min:0'],
            'min_order_qty' => ['sometimes', 'numeric', 'min:0.001'],
            'description' => ['sometimes', 'string', 'max:5000'],
            'brand' => ['sometimes', 'string', 'max:120'],
            'unit' => ['sometimes', 'string', 'max:60'],
            'generic_name' => ['sometimes', 'string', 'max:255'],
            'strength' => ['sometimes', 'string', 'max:60'],
            'dosage_form' => ['sometimes', 'string', 'max:40'],
            'drug_schedule' => ['sometimes', 'string', 'max:20'],
            'kitchen_station' => ['sometimes', 'string', 'max:60'],
            'batch_number' => ['sometimes', 'string', 'max:60'],
            'warranty_months' => ['sometimes', 'integer', 'min:0', 'max:600'],
            'duration_minutes' => ['sometimes', 'integer', 'min:1', 'max:1440'],
        ], [
            'plu_code.regex' => $this->called('plu_code').' is 1 to 7 digits.',
        ], $this->headings + ProductCsv::HEADERS);

        return $validator->errors()->all();
    }

    /**
     * A category cell, looked up — and never made up.
     *
     * @return array{id?: string, create?: bool, outcome?: 'skip'|'waiting', error?: string}
     */
    private function category(string $typed): array
    {
        $found = $this->categories->resolve($typed);

        if ($found['status'] === 'found') {
            return ['id' => $found['id']];
        }

        if ($found['status'] === 'ambiguous') {
            return ['error' => "Category \"{$typed}\" is on more than one shelf (".implode(', ', $found['candidates']).'). Write the whole path.'];
        }

        $key = CategoryPaths::key($typed);
        $choice = $this->decisions[$key] ?? null;

        if ($choice !== null) {
            if ($choice['action'] === 'create') {
                return ['create' => true];
            }
            if ($choice['action'] === 'skip') {
                return ['outcome' => 'skip'];
            }
            // Mapped to one of the shop's own — and checked to BE one of the
            // shop's own. An id is never taken on trust, from a file or a form.
            if ($choice['action'] === 'map' && is_string($choice['id'] ?? null) && $this->categories->has($choice['id'])) {
                return ['id' => $choice['id']];
            }
        }

        $this->unknown[$key] ??= ['name' => $typed, 'rows' => 0, 'suggestion' => $found['suggestion']];
        $this->unknown[$key]['rows']++;

        if ($this->dry) {
            return ['outcome' => 'waiting'];
        }

        $meant = $found['suggestion'] !== null ? " Did you mean \"{$found['suggestion']['path']}\"?" : '';

        return ['error' => "Category \"{$typed}\" is not in your shop.{$meant} Choose what to do with it and import again."];
    }

    // ── sizes ────────────────────────────────────────────────────────

    /**
     * SIZES, IN THE SAME FILE AS THEIR PRODUCTS.
     *
     * A size is a ROW, named by Parent SKU — not a cell like
     * `Small=900|Large=1000`, because a size has a price, a cost, a stock
     * figure, a barcode and a SKU, and a merchant editing a price in Excel
     * should be editing a number in a column.
     *
     * It MERGES rather than replacing. `SyncProductVariantsAction` retires
     * whatever is missing from the list it is given — right for the edit
     * screen, wrong here: a corrected price for Large alone would retire Small
     * and Medium in silence. Removing a size stays a deliberate act.
     *
     * @param  array<int, array{line: int, cells: array<string, string>, raw: array<string, string>}>  $rows
     */
    private function sizes(array $rows): void
    {
        foreach ($this->byParent($rows) as $parentSku => $group) {
            $parent = Product::query()->where('sku', $parentSku)->first();
            if ($parent === null) {
                $this->orphans($group, $parentSku, 'size');

                continue;
            }

            $desired = $parent->variants()->get()
                ->map(fn (ProductVariant $v): array => [
                    'id' => $v->id,
                    'name' => $v->name,
                    'sku' => $v->sku,
                    'price' => $v->price,
                    'cost' => $v->cost,
                    'low_stock_threshold' => $v->low_stock_threshold,
                    'is_active' => $v->is_active,
                ])
                ->all();

            $accepted = [];
            foreach ($group as $row) {
                [$data, $errors] = $this->read($row['cells']);

                // A size already on this product — by SKU where it has one,
                // else by the name the merchant typed.
                $at = null;
                foreach ($desired as $i => $have) {
                    $sameSku = isset($data['sku']) && $have['sku'] === $data['sku'];
                    $sameName = ! isset($data['sku']) && isset($data['name']) && strcasecmp((string) $have['name'], $data['name']) === 0;
                    if ($sameSku || $sameName) {
                        $at = $i;
                        break;
                    }
                }

                if ($at === null && ! isset($data['name'])) {
                    $errors[] = 'Name is missing — a size is called something (Small, 500ml).';
                }
                if ($at === null && ! isset($data['price']) && ($row['cells']['price'] ?? '') === '') {
                    $errors[] = $this->called('price').' is missing.';
                }
                array_push($errors, ...$this->rules($data));

                if ($errors !== []) {
                    $this->out['total']++;
                    $this->refuse($row, $errors);

                    continue;
                }

                $fields = array_intersect_key($data, array_flip(['name', 'sku', 'price', 'cost', 'low_stock_threshold', 'is_active', 'barcode']));

                if ($at !== null) {
                    $desired[$at] = [...$desired[$at], ...$fields];
                    $accepted[] = [$row, 'updated'];
                } else {
                    // Stock only on the way IN: an existing size's quantity
                    // goes through InventoryService or not at all.
                    $desired[] = [
                        'sku' => null, 'cost' => null, 'low_stock_threshold' => null, 'is_active' => true, 'barcode' => null,
                        ...$fields,
                        'stock_quantity' => $data['stock_quantity'] ?? 0,
                    ];
                    $accepted[] = [$row, 'created'];
                }
            }

            $this->settle($accepted, fn () => $this->variants->execute($parent, $desired));
        }
    }

    // ── packs ────────────────────────────────────────────────────────

    /**
     * A CARTON OF 24, as a row under the item it is a carton of.
     *
     * Stock is one pool, kept in the base unit: a pack is a way of SELLING and
     * RECEIVING it, with its own price and its own barcode. So a pack row
     * carries no stock — the pieces are on the product's own row.
     *
     * Merged by the pack's name, like sizes: a file that mentions Carton does
     * not retire the Strip it did not mention.
     *
     * @param  array<int, array{line: int, cells: array<string, string>, raw: array<string, string>}>  $rows
     */
    private function packs(array $rows): void
    {
        foreach ($this->byParent($rows) as $parentSku => $group) {
            $parent = Product::query()->where('sku', $parentSku)->first();
            if ($parent === null) {
                $this->orphans($group, $parentSku, 'pack');

                continue;
            }

            $desired = $parent->units()->orderBy('sort_order')->get()
                ->map(fn (ProductUnit $u): array => [
                    'name' => $u->name, 'factor' => (float) $u->factor, 'price' => $u->price, 'barcode' => $u->barcode,
                ])
                ->all();

            $accepted = [];
            foreach ($group as $row) {
                [$data, $errors] = $this->read($row['cells']);

                if (! isset($data['name'])) {
                    $errors[] = 'Name is missing — a pack is called something (Carton, Strip, Dozen).';
                }
                if (isset($data['pack_size']) && $data['pack_size'] <= 1) {
                    $errors[] = 'Pack Size is how many it holds, so it is more than 1.';
                }
                // `item_type`, not `type`: the second is an enum, and compared
                // to a word it is never equal — every pack was refused.
                if (in_array($parent->item_type, [ItemTypes::SERVICE, ItemTypes::DEAL], true)) {
                    $errors[] = "\"{$parent->name}\" is not something sold in packs.";
                }
                array_push($errors, ...$this->rules($data));

                if ($errors !== []) {
                    $this->out['total']++;
                    $this->refuse($row, $errors);

                    continue;
                }

                $pack = [
                    'name' => $data['name'],
                    'factor' => (float) $data['pack_size'],
                    'price' => $data['price'] ?? null,
                    'barcode' => $data['barcode'] ?? null,
                ];
                // The pack's OTHER codes, when the row gives any. Left off
                // otherwise — to SyncProductUnitsAction an absent list means
                // "as it was", so a file that says nothing of them does not
                // strip every carton of its second code.
                $others = ($data['barcodes'] ?? []) !== [] ? ['barcodes' => $data['barcodes']] : [];

                $at = null;
                foreach ($desired as $i => $have) {
                    if (strcasecmp((string) $have['name'], $pack['name']) === 0) {
                        $at = $i;
                        break;
                    }
                }

                if ($at !== null) {
                    // A blank price or barcode leaves the one it has.
                    $desired[$at] = [
                        'name' => $pack['name'],
                        'factor' => $pack['factor'],
                        'price' => $pack['price'] ?? $desired[$at]['price'],
                        'barcode' => $pack['barcode'] ?? $desired[$at]['barcode'],
                    ] + $others;
                    $accepted[] = [$row, 'updated'];
                } else {
                    $desired[] = $pack + $others;
                    $accepted[] = [$row, 'created'];
                }
            }

            $this->settle($accepted, fn () => $this->units->execute($parent, $desired));
        }
    }

    /**
     * @param  array<int, array{line: int, cells: array<string, string>, raw: array<string, string>}>  $rows
     * @return array<string, array<int, array{line: int, cells: array<string, string>, raw: array<string, string>}>>
     */
    private function byParent(array $rows): array
    {
        $groups = [];
        foreach ($rows as $row) {
            [$sku] = Cell::code($row['cells']['parent_sku']);
            $groups[(string) $sku][] = $row;
        }

        return $groups;
    }

    /** @param  array<int, array{line: int, cells: array<string, string>, raw: array<string, string>}>  $group */
    private function orphans(array $group, string $parentSku, string $what): void
    {
        foreach ($group as $row) {
            $this->out['total']++;
            $this->refuse($row, ["No product in this shop has the SKU \"{$parentSku}\", so this {$what} has nothing to belong to."]);
        }
    }

    /**
     * Save one parent's sizes or packs, and count each row by how that went.
     *
     * They are saved together, so they stand or fall together: a barcode one
     * of them shares with another product refuses the group, said on each row.
     *
     * @param  array<int, array{0: array{line: int, cells: array<string, string>, raw: array<string, string>}, 1: 'created'|'updated'}>  $accepted
     */
    private function settle(array $accepted, callable $save): void
    {
        if ($accepted === []) {
            return;
        }

        try {
            DB::transaction($save);
        } catch (DomainException $e) {
            foreach ($accepted as [$row]) {
                $this->out['total']++;
                $this->refuse($row, [$e->getMessage()]);
            }

            return;
        } catch (QueryException) {
            foreach ($accepted as [$row]) {
                $this->out['total']++;
                $this->refuse($row, ['A barcode or SKU in this row is already in use.']);
            }

            return;
        }

        foreach ($accepted as [, $outcome]) {
            $this->out['total']++;
            $this->out[$outcome]++;
        }
    }

    // ── codes ────────────────────────────────────────────────────────

    /**
     * Duplicate barcode / PLU protection the DB cannot fully give (the primary
     * barcode column has no unique index): checked against everything already
     * in the shop — primary barcodes, alternates, and pack barcodes.
     *
     * "Already in the shop" includes the rows of this file above this one:
     * each is saved before the next is looked at. A separate list of codes
     * "seen so far" used to sit beside this and could not be made to matter —
     * removing it changed no outcome.
     *
     * @param  array<string, mixed>  $data
     */
    private function guardUniqueCodes(array $data, ?Product $existing): void
    {
        $errors = [];

        if (isset($data['barcode'])) {
            $code = (string) $data['barcode'];
            $inShop = Product::query()->where('barcode', $code)
                ->when($existing !== null, fn ($q) => $q->whereKeyNot($existing->id))
                ->exists()
                || ProductBarcode::query()->where('barcode', $code)
                    ->when($existing !== null, fn ($q) => $q->where('product_id', '!=', $existing->id))
                    ->exists()
                || ProductUnit::query()->where('barcode', $code)
                    ->when($existing !== null, fn ($q) => $q->where('product_id', '!=', $existing->id))
                    ->exists();

            if ($inShop) {
                $errors[] = "Barcode {$code} is already in use.";
            }
        }

        if (isset($data['plu_code'])) {
            $plu = (string) $data['plu_code'];
            $inShop = Product::query()->where('plu_code', $plu)
                ->when($existing !== null, fn ($q) => $q->whereKeyNot($existing->id))
                ->exists();

            if ($inShop) {
                $errors[] = "PLU {$plu} is already in use.";
            }
        }

        if ($errors !== []) {
            throw new RowRefused($errors);
        }
    }

    /**
     * The import itself, as one line somebody can read: "340 items updated by
     * Asif at 11:04" is the sentence a shopkeeper needs when a shelf price is
     * suddenly wrong and nobody remembers touching it.
     */
    private function recordTheImport(int $before): void
    {
        if ($this->out['created'] === 0 && $this->out['updated'] === 0) {
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
                'created' => $this->out['created'],
                'updated' => $this->out['updated'],
                'failed' => $this->out['failed'],
            ],
            'ip_address' => request()?->ip(),
        ]);
    }
}

/** Internal: a row that is not taken, and every reason why. */
class RowRefused extends \Exception
{
    /** @param string[] $messages */
    public function __construct(public array $messages)
    {
        parent::__construct(implode(' ', $messages));
    }
}
