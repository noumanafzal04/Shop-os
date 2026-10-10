<?php

namespace App\Support\Import;

use App\Models\Product;
use App\Models\ProductUnit;
use App\Models\ProductVariant;
use App\Models\TaxGroup;
use App\Models\Tenant;
use App\Support\BusinessTypes;
use App\Support\CsvExport;
use App\Support\ItemTypes;
use App\Support\ProductCsv;
use App\Support\Spreadsheet\XlsxWriter;
use App\Support\Spreadsheet\Zip;
use Illuminate\Support\Collection;
use Symfony\Component\HttpFoundation\Response;

/**
 * The sheet a shop is handed — blank to fill in, or full of what it has.
 *
 * Both are the SAME sheet: the same columns in the same order, so an export
 * can be corrected in Excel and sent straight back through the import. Every
 * row is built by FIELD, never by position — the export used to be a list of
 * cells in an order that had to match the header by hand, and one new header
 * silently moved every barcode under the wrong heading.
 */
final class ProductSheet
{
    /** Columns kept as TEXT in Excel, so a code is not turned into a number. */
    private const AS_TEXT = ['sku', 'parent_sku', 'barcode', 'barcodes', 'plu_code', 'batch_number', 'expiry_date'];

    private const YES_NO = ['requires_prescription', 'is_active', 'visible_in_marketplace', 'tracks_serial', 'track_inventory'];

    /**
     * What each column is for, in the words of somebody filling it in.
     *
     * @var array<string, string>
     */
    private const GUIDE = [
        'name' => 'What the item is called — on the till, the receipt and online.',
        'item_type' => 'What kind of item it is. Leave it blank for the kind your shop mostly sells.',
        'sku' => 'Your own code for the item. Rows are matched on it: a SKU you already have is UPDATED, a new one is added.',
        'parent_sku' => 'Only for a SIZE or a PACK of another item: the SKU of the item it belongs to.',
        'pack_size' => 'Only for a PACK: how many it holds (a carton of 24 is 24). Name is what the pack is called, Price is for the whole pack.',
        'barcode' => 'The barcode printed on it. This column is Text — leave it that way, or Excel rounds long numbers.',
        'barcodes' => 'Any other barcodes the same item carries, with | between them. On a PACK row, the other codes printed on that pack.',
        'plu_code' => 'The scale code for an item sold by weight (1 to 7 digits).',
        'brand' => 'The maker or brand name.',
        'category' => 'One of your categories — pick from the list. A sub-category is written Parent > Child. One you do not have yet is asked about when you import; it is never made from a spelling mistake.',
        'unit' => 'What one of it is: Piece, KG, Strip, Plate…',
        'sold_by' => 'Piece, or Weight for things sold loose.',
        'price' => 'What you sell one for, in rupees.',
        'cost' => 'What one costs you.',
        'wholesale_price' => 'The price for a wholesale customer, if you have one.',
        'discount_price' => 'A marked-down price, while it is on sale.',
        'tax_rate' => 'The item\'s own tax %, where it differs from your shop\'s.',
        'tax_group' => 'One of your tax groups, by name.',
        'stock_quantity' => 'How many you have now. For an item you already have, this is taken as a recount.',
        'low_stock_threshold' => 'Warn me when it falls to this many.',
        'min_order_qty' => 'The least a customer may order.',
        'track_inventory' => 'Yes to count stock of it. No to sell it without counting.',
        'expiry_date' => 'For a medicine that arrives with stock: when that stock expires. 31/03/2027, or 03/2027 for the end of the month.',
        'batch_number' => 'The lot number printed on the pack.',
        'generic_name' => 'The salt / formula, so the same medicine under another brand can be offered.',
        'strength' => '500mg, 5ml…',
        'dosage_form' => 'Tablet, Syrup, Injection…',
        'drug_schedule' => 'Its schedule, where it has one. A scheduled medicine always needs a prescription.',
        'requires_prescription' => 'Yes if it may only be sold against a prescription.',
        'kitchen_station' => 'Where it is made — Kitchen, Bar, Grill.',
        'tracks_serial' => 'Yes if each one is sold by its own serial number or IMEI.',
        'warranty_months' => 'How many months of warranty it carries.',
        'duration_minutes' => 'How long the service takes.',
        'description' => 'What a customer reads about it online.',
        'is_active' => 'No takes it off sale without deleting it.',
        'visible_in_marketplace' => 'No keeps it out of your online shop.',
    ];

    // ── the blank sheet ──────────────────────────────────────────────

    /**
     * @return array{columns: array<string, string>, rows: array<int, array<string, string|int|float>>}
     */
    public static function template(?Tenant $tenant): array
    {
        $columns = ProductCsv::columnsFor($tenant);
        $type = $tenant?->business_type;

        $units = $type !== null ? BusinessTypes::unitsFor($type) : [];
        $unit = is_string($units[0] ?? null) ? $units[0] : 'Piece';

        // One of the shop's OWN shelves, or none. The example used to name a
        // shelf from the trade's template, which a shop that had renamed or
        // removed it would be asked about on its very first upload.
        $category = CategoryPaths::ofThisShop()->all()[0] ?? '';

        $kinds = ProductCsv::importableTypes($tenant);
        $sku = fn (string $kind): string => 'EXAMPLE-'.(array_search($kind, $kinds, true) + 1);

        $rows = [];
        foreach ($kinds as $kind) {
            $rows[] = self::only($columns, ['sku' => $sku($kind)] + self::example($kind, $category, $unit));
        }

        // …one worked SIZE and one worked PACK, where the shop has the column
        // that makes a row one — each under an example it makes sense for. A
        // dish comes in a Half and a Full; it does not come in a carton.
        $sized = $kinds[0] ?? null;
        if ($sized !== null && isset($columns['parent_sku']) && $sized !== ItemTypes::SERVICE
            && BusinessTypes::variantAttributesFor((string) $type) !== []) {
            $rows[] = self::only($columns, [
                'name' => 'Large', 'parent_sku' => $sku($sized), 'sku' => $sku($sized).'-L', 'price' => 600, 'cost' => 400,
                'stock_quantity' => 10, 'is_active' => 'Yes',
                'description' => 'A SIZE of '.$sku($sized).' - fill Parent SKU to make one',
            ]);
        }

        $packed = array_values(array_intersect($kinds, [ItemTypes::PHYSICAL, ItemTypes::MEDICINE]))[0] ?? null;
        if ($packed !== null && isset($columns['pack_size'])) {
            $rows[] = self::only($columns, [
                'name' => 'Carton', 'parent_sku' => $sku($packed), 'pack_size' => 24, 'price' => 11000,
                'description' => 'A PACK of '.$sku($packed).' - Parent SKU and Pack Size make one',
            ]);
        }

        return ['columns' => $columns, 'rows' => $rows];
    }

    /**
     * A worked example row for one kind of item, in the shop's own words. The
     * name says EXAMPLE for the case the template is uploaded as it stands,
     * which is a thing people do.
     *
     * @return array<string, string|int|float>
     */
    private static function example(string $kind, string $category, string $unit): array
    {
        $service = $kind === ItemTypes::SERVICE;
        $medicine = $kind === ItemTypes::MEDICINE;

        return [
            'name' => 'EXAMPLE - delete this row',
            'item_type' => (string) (ItemTypes::all()[$kind]['label'] ?? $kind),
            'category' => $category,
            'unit' => $unit,
            'sold_by' => 'Piece',
            'price' => 500,
            'cost' => 350,
            'stock_quantity' => $service ? '' : 20,
            'low_stock_threshold' => $service ? '' : 5,
            'track_inventory' => $service ? '' : 'Yes',
            'expiry_date' => $medicine ? '12/'.(((int) date('Y')) + 2) : '',
            'batch_number' => $medicine ? 'B-001' : '',
            'is_active' => 'Yes',
            'visible_in_marketplace' => 'Yes',
            'description' => 'Replace these rows with your own items',
            'strength' => $medicine ? '500mg' : '',
            'dosage_form' => $medicine ? 'Tablet' : '',
            'generic_name' => $medicine ? 'Paracetamol' : '',
            'requires_prescription' => $medicine ? 'No' : '',
            'kitchen_station' => $kind === ItemTypes::FOOD ? 'Kitchen' : '',
            'tracks_serial' => $kind === ItemTypes::PHYSICAL ? 'No' : '',
            'warranty_months' => '',
            'duration_minutes' => $service ? 30 : '',
        ];
    }

    // ── what the shop has ────────────────────────────────────────────

    /**
     * The catalogue as rows that can be sent back: each product, then its
     * sizes and its packs under it, named by its SKU.
     *
     * @param  Collection<int, Product>  $products  with category, taxGroup, barcodes, variants, units
     * @param  array<string, string>  $columns
     * @return array<int, array<string, string|int|float|null>>
     */
    public static function rows(Collection $products, array $columns): array
    {
        $paths = CategoryPaths::ofThisShop();
        $rows = [];

        foreach ($products as $p) {
            $rows[] = self::only($columns, [
                'name' => $p->name,
                'item_type' => $p->item_type,
                'sku' => $p->sku,
                'barcode' => $p->barcode,
                // The piece's own other codes — not a size's, and not a pack's:
                // each of those is written on its own row below.
                'barcodes' => $p->barcodes->whereNull('variant_id')->whereNull('product_unit_id')->pluck('barcode')->reject(fn ($b) => $b === $p->barcode)->implode('|'),
                'plu_code' => $p->plu_code,
                'brand' => $p->brand,
                // The PATH, so two shelves with one name come back as two.
                'category' => $paths->pathOf($p->category_id),
                'unit' => $p->unit,
                'sold_by' => $p->sold_by,
                'price' => $p->price,
                'cost' => $p->cost,
                'wholesale_price' => $p->wholesale_price,
                'discount_price' => $p->discount_price,
                'tax_rate' => $p->tax_rate,
                'tax_group' => $p->taxGroup?->name,
                'stock_quantity' => $p->stock_quantity,
                'low_stock_threshold' => $p->low_stock_threshold,
                'min_order_qty' => $p->min_order_qty,
                'track_inventory' => $p->track_inventory ? 1 : 0,
                'generic_name' => $p->generic_name,
                'strength' => $p->strength,
                'dosage_form' => $p->dosage_form,
                'drug_schedule' => $p->drug_schedule,
                'requires_prescription' => $p->requires_prescription ? 1 : 0,
                'kitchen_station' => $p->kitchen_station,
                'tracks_serial' => $p->tracks_serial ? 1 : 0,
                'warranty_months' => $p->warranty_months,
                'duration_minutes' => $p->duration_minutes,
                'description' => $p->description,
                'is_active' => $p->is_active ? 1 : 0,
                'visible_in_marketplace' => $p->visible_in_marketplace ? 1 : 0,
            ]);

            // A size or a pack is named by its parent's SKU. Without one there
            // is nothing to name it by, and a row that cannot find its parent
            // would come back in as a product of its own.
            if (blank($p->sku)) {
                continue;
            }

            /** @var ProductVariant $v */
            foreach ($p->variants as $v) {
                $rows[] = self::only($columns, [
                    'name' => $v->name,
                    'sku' => $v->sku,
                    'parent_sku' => $p->sku,
                    'barcode' => $p->barcodes->firstWhere('variant_id', $v->id)?->barcode,
                    'price' => $v->price,
                    'cost' => $v->cost,
                    'stock_quantity' => $v->stock_quantity,
                    'low_stock_threshold' => $v->low_stock_threshold,
                    'is_active' => $v->is_active ? 1 : 0,
                ]);
            }

            /** @var ProductUnit $u */
            foreach ($p->units as $u) {
                $rows[] = self::only($columns, [
                    'name' => $u->name,
                    'parent_sku' => $p->sku,
                    'pack_size' => (float) $u->factor,
                    'barcode' => $u->barcode,
                    // Every other code printed on the pack, as the item's own
                    // row has for the piece.
                    'barcodes' => $p->barcodes->where('product_unit_id', $u->id)->pluck('barcode')->implode('|'),
                    'price' => $u->price,
                ]);
            }
        }

        return $rows;
    }

    // ── handing it over ──────────────────────────────────────────────

    /**
     * @param  array<string, string>  $columns  field => header
     * @param  array<int, array<string, string|int|float|null>>  $rows  field-keyed
     */
    public static function download(string $name, string $format, array $columns, array $rows, ?Tenant $tenant): Response
    {
        $fields = array_keys($columns);
        $grid = array_map(
            fn (array $row): array => array_map(fn (string $f) => $row[$f] ?? '', $fields),
            $rows,
        );

        // Asked for Excel on a server that cannot zip: the CSV is the same
        // sheet, and a download beats an error page.
        if ($format !== 'xlsx' || ! Zip::available()) {
            return CsvExport::stream($name.'.csv', array_values($columns), $grid);
        }

        $lists = self::lists($tenant);
        $listSheet = [array_keys($lists)];
        $longest = max(1, ...array_map('count', array_values($lists) ?: [[]]));
        for ($i = 0; $i < $longest; $i++) {
            $listSheet[] = array_map(fn (array $values) => $values[$i] ?? '', array_values($lists));
        }

        // Where each list lives on the hidden sheet, for a column to point at.
        $range = function (string $list) use ($lists): ?string {
            $at = array_search($list, array_keys($lists), true);
            $count = count($lists[$list] ?? []);
            if ($at === false || $count === 0) {
                return null;
            }
            $col = XlsxWriter::column((int) $at);

            return 'Lists!$'.$col.'$2:$'.$col.'$'.($count + 1);
        };

        $dropdowns = [];
        foreach ($fields as $index => $field) {
            $source = match (true) {
                $field === 'category' => $range('Category'),
                $field === 'unit' => $range('Unit'),
                $field === 'tax_group' => $range('Tax Group'),
                $field === 'item_type' => $range('Item Type'),
                $field === 'sold_by' => ['Piece', 'Weight'],
                in_array($field, self::YES_NO, true) => ['Yes', 'No'],
                default => null,
            };
            if ($source === null) {
                continue;
            }

            $dropdowns[] = [
                'column' => $index,
                'source' => $source,
                // A category or a unit the shop does not have yet is a thing
                // somebody may mean to type; a third answer to Yes/No is not.
                'strict' => ! in_array($field, ['category', 'unit'], true),
                'prompt' => match ($field) {
                    'category' => 'That is not one of your categories yet. You will be asked about it when you import.',
                    'unit' => 'That is not one of your usual units. Keep it if you mean it.',
                    default => 'Pick one from the list.',
                },
            ];
        }

        $guide = [['Column', 'What goes in it']];
        foreach ($columns as $field => $header) {
            $guide[] = [$header, self::GUIDE[$field] ?? ''];
        }
        array_push(
            $guide,
            ['', ''],
            ['Good to know', 'The first row is the headings — do not change them. Only Name and Price must be filled in for a new item.'],
            ['', 'A blank cell means "leave it as it is": to change prices, a sheet with SKU and Price is enough.'],
            ['', 'Nothing is saved until you have seen the preview and pressed Import.'],
        );

        $bytes = (new XlsxWriter)
            ->sheet('Products', [array_values($columns), ...$grid], [
                'widths' => array_map(fn (string $f): int => match (true) {
                    in_array($f, ['name', 'description', 'category'], true) => 32,
                    in_array($f, ['barcode', 'barcodes', 'generic_name'], true) => 22,
                    default => 16,
                }, $fields),
                'text' => array_keys(array_intersect($fields, self::AS_TEXT)),
                'required' => array_keys(array_intersect($fields, ['name', 'price'])),
                'lists' => $dropdowns,
                'rowsOfLists' => max(3000, count($grid) + 500),
            ])
            ->sheet('How to fill this in', $guide, ['widths' => [26, 110]])
            ->sheet('Lists', $listSheet, ['hidden' => true, 'widths' => [40, 18, 24, 22]])
            ->bytes();

        return response($bytes, 200, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition' => 'attachment; filename="'.$name.'.xlsx"',
            'Cache-Control' => 'no-store, no-cache',
        ]);
    }

    /**
     * What the drop-downs offer: the shop's own categories, units, tax groups
     * and kinds of item — read now, from this shop, and from nowhere else.
     *
     * @return array<string, string[]>
     */
    private static function lists(?Tenant $tenant): array
    {
        $type = $tenant?->business_type;

        return [
            'Category' => CategoryPaths::ofThisShop()->all(),
            'Unit' => array_values(array_filter($type !== null ? BusinessTypes::unitsFor($type) : [], 'is_string')),
            'Tax Group' => TaxGroup::query()->orderBy('name')->pluck('name')->all(),
            'Item Type' => array_map(
                fn (string $kind): string => (string) (ItemTypes::all()[$kind]['label'] ?? $kind),
                ProductCsv::importableTypes($tenant),
            ),
        ];
    }

    /**
     * @param  array<string, string>  $columns
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>
     */
    private static function only(array $columns, array $values): array
    {
        return array_intersect_key($values, $columns);
    }
}
