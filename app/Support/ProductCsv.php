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

    /** The header row, in column order. */
    public static function headerRow(): array
    {
        return array_values(self::HEADERS);
    }

    /** The field names, in the same order — what each column holds. */
    public static function fields(): array
    {
        return array_keys(self::HEADERS);
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
