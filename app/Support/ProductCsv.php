<?php

namespace App\Support;

/**
 * The column list a merchant's catalog file uses, and what each column is
 * CALLED on the page.
 *
 * The export and the blank template shipped the raw field names — `item_type`,
 * `plu_code`, `low_stock_threshold`, `visible_in_marketplace`. That is the
 * database talking to a shopkeeper in Lahore who opened the file in Excel to
 * price up his shelves. QA reported it plainly: "in csv its showing db/column
 * name".
 *
 * The headers are Title Case with the SAME WORDS as the field, deliberately.
 * ImportProductsAction normalises every incoming header with
 * `str_replace(' ', '_', strtolower(trim($h)))`, so "Item Type" arrives as
 * `item_type` and the export → edit → re-import round trip keeps working for
 * free — including for files exported before this change. Renaming a column to
 * something friendlier but different ("Show online" for
 * `visible_in_marketplace`) would normalise to a field that does not exist and
 * silently drop on import, which is a worse bug than the one being fixed.
 *
 * So: change the CASING and the SPACING here, never the words.
 */
class ProductCsv
{
    /**
     * Field name → the header a merchant reads. Order is the column order in
     * both the export and the blank template, which is why one list serves
     * both: two lists drift, and a template whose columns do not match the
     * export is a template that teaches the wrong shape.
     *
     * @var array<string, string>
     */
    public const HEADERS = [
        'name' => 'Name',
        'item_type' => 'Item Type',
        'sku' => 'SKU',
        'parent_sku' => 'Parent SKU',
        'barcode' => 'Barcode',
        'barcodes' => 'Barcodes',
        'plu_code' => 'PLU Code',
        'brand' => 'Brand',
        'category' => 'Category',
        'unit' => 'Unit',
        'sold_by' => 'Sold By',
        'price' => 'Price',
        'cost' => 'Cost',
        'wholesale_price' => 'Wholesale Price',
        'discount_price' => 'Discount Price',
        'tax_rate' => 'Tax Rate',
        'tax_group' => 'Tax Group',
        'stock_quantity' => 'Stock Quantity',
        'low_stock_threshold' => 'Low Stock Threshold',
        'min_order_qty' => 'Min Order Qty',
        'track_inventory' => 'Track Inventory',

        // Pharmacy
        'generic_name' => 'Generic Name',
        'strength' => 'Strength',
        'dosage_form' => 'Dosage Form',
        'drug_schedule' => 'Drug Schedule',
        'requires_prescription' => 'Requires Prescription',

        // Food
        'kitchen_station' => 'Kitchen Station',

        // Retail / automotive / petroleum
        'tracks_serial' => 'Tracks Serial',
        'warranty_months' => 'Warranty Months',

        // Services
        'duration_minutes' => 'Duration Minutes',

        'description' => 'Description',
        'is_active' => 'Is Active',
        'visible_in_marketplace' => 'Visible In Marketplace',
    ];

    /**
     * Columns that belong to ONE trade, and to no other.
     *
     * ── Why a shop must not be shown every column ───────────────────────
     *
     * A restaurant's template carried `Strength`, `Dosage Form`, `Drug
     * Schedule`, `Tracks Serial` and `Warranty Months` — thirty-two columns
     * where twelve applied. Every one of those is a thing to get wrong, in a
     * file a shopkeeper is filling in by hand in Excel to price up his
     * shelves.
     *
     * Anything not named here is UNIVERSAL and every trade gets it. The list
     * is deliberately the exception rather than the rule: a column added next
     * year is shown to everybody until somebody decides it belongs to one
     * trade, which is the safe direction to be wrong in.
     *
     * @var array<string, string[]>
     */
    public const TRADE_ONLY = [
        'generic_name' => ['pharmacy'],
        'strength' => ['pharmacy'],
        'dosage_form' => ['pharmacy'],
        'drug_schedule' => ['pharmacy'],
        'requires_prescription' => ['pharmacy'],
        'kitchen_station' => ['food'],
        'tracks_serial' => ['retail', 'automotive', 'petroleum'],
        'warranty_months' => ['retail', 'automotive', 'petroleum'],
        'duration_minutes' => ['services'],
        // Weight-sold lines with a scale label. A restaurant does not price a
        // dish by the kilo, and a phone shop does not weigh a handset.
        'plu_code' => ['mart', 'pharmacy'],
    ];

    /**
     * The columns THIS shop should be given.
     *
     * A null business type — a tenant whose type was never set — gets every
     * column rather than none. Guessing narrow would hand somebody a template
     * missing the field their catalog turns on.
     *
     * @return array<string, string> field => header
     */
    public static function headersFor(?string $businessType): array
    {
        if ($businessType === null) {
            return self::HEADERS;
        }

        return array_filter(
            self::HEADERS,
            fn (string $field): bool => ! isset(self::TRADE_ONLY[$field])
                || in_array($businessType, self::TRADE_ONLY[$field], true),
            ARRAY_FILTER_USE_KEY,
        );
    }

    /**
     * The header row, in column order.
     *
     * Still every column when nobody says otherwise, because the EXPORT uses
     * this: an export is a backup as much as a spreadsheet, and one that
     * dropped a shop's prescription flags would lose them on the round trip.
     * Only the blank template narrows — see `headersFor`.
     */
    public static function headerRow(?string $businessType = null): array
    {
        return array_values(self::headersFor($businessType));
    }

    /** The field names, in the same order — what each column holds. */
    public static function fields(?string $businessType = null): array
    {
        return array_keys(self::headersFor($businessType));
    }

    /**
     * A worked example row for one item type, in this shop's own words.
     *
     * ── Why these are GENERATED and not a hand-written list ─────────────
     *
     * The template used to carry six hard-coded rows — a sugar, a Panadol, a
     * karahi, a phone, a service — handed to every shop whatever it sold. The
     * importer meanwhile refuses an item type the trade may not catalog, from
     * `BusinessTypes::itemTypesFor()`. Two lists, and they disagreed: a
     * restaurant that downloaded the template and uploaded it back UNCHANGED
     * got two rows refused for types the file had just given it — and the
     * other four imported, so its catalog gained Loose Sugar and a Galaxy A16.
     *
     * So the rows come off the same list the validator reads. A template
     * cannot offer a row the importer will refuse, because there is no second
     * list to drift from.
     *
     * The names say EXAMPLE for the case the template is uploaded as it
     * stands, which is a thing people do: three obviously-named rows to delete
     * beats four real-looking products nobody notices.
     *
     * @param  array<string, string>  $columns  field => header, already narrowed
     * @return array<int, string> one cell per column, in column order
     */
    public static function exampleRow(string $itemType, string $category, string $unit, array $columns): array
    {
        $by = [
            'name' => 'EXAMPLE - delete this row',
            'item_type' => $itemType,
            'sku' => 'EXAMPLE-1',
            'category' => $category,
            'unit' => $unit,
            'sold_by' => 'unit',
            'price' => '500',
            'cost' => '350',
            'stock_quantity' => $itemType === ItemTypes::SERVICE ? '' : '20',
            'low_stock_threshold' => $itemType === ItemTypes::SERVICE ? '' : '5',
            'track_inventory' => $itemType === ItemTypes::SERVICE ? '0' : '1',
            'is_active' => '1',
            'visible_in_marketplace' => '1',
            'description' => 'Replace these rows with your own items',
            // Trade columns only appear when the trade has them, so filling
            // them here costs nothing to a shop that will never see them.
            'strength' => '500mg',
            'dosage_form' => 'Tablet',
            'drug_schedule' => 'OTC',
            'generic_name' => 'Paracetamol',
            'requires_prescription' => '0',
            'kitchen_station' => 'Kitchen',
            'tracks_serial' => '0',
            'warranty_months' => '12',
            'duration_minutes' => '30',
        ];

        return array_map(fn (string $field): string => $by[$field] ?? '', array_keys($columns));
    }

    /**
     * A worked SIZE row, so the shape is obvious without reading a manual.
     *
     * `parent_sku` is what makes a row a size rather than a product, and it
     * names the parent by SKU on purpose: the file never carries an id. A
     * shopkeeper knows their own SKU; they cannot know a uuid that does not
     * exist until the row above them is imported.
     *
     * @param  array<string, string>  $columns
     * @return array<int, string>
     */
    public static function exampleVariantRow(string $category, string $unit, array $columns): array
    {
        $by = [
            'name' => 'Large',
            'parent_sku' => 'EXAMPLE-1',
            'sku' => 'EXAMPLE-1-L',
            'category' => $category,
            'unit' => $unit,
            'sold_by' => 'unit',
            'price' => '600',
            'cost' => '400',
            'stock_quantity' => '10',
            'is_active' => '1',
            'description' => 'A SIZE of the row above - fill Parent SKU to make one',
        ];

        return array_map(fn (string $field): string => $by[$field] ?? '', array_keys($columns));
    }

    /**
     * What a header normalises to on the way back in. Mirrors the rule in
     * ImportProductsAction so the round trip can be asserted rather than
     * assumed.
     */
    public static function normalise(string $header): string
    {
        return str_replace(' ', '_', strtolower(trim($header)));
    }
}
