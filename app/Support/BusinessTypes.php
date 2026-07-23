<?php

namespace App\Support;

use App\Support\ItemTypes;

/**
 * Business-type registry — the core of ShopOS's business-type awareness.
 *
 * NOTHING in the platform is hardcoded to retail. A tenant's selected type
 * determines:
 *   - feature defaults (marketplace, reservations, delivery, inventory, services)
 *   - default product/service categories (template, fully editable after)
 *   - default expense categories (template, fully editable after)
 *
 * The effective capability of a tenant is always:
 *   plan allows it (online_shop_enabled) AND business type supports it
 *   AND tenant hasn't disabled it — computed via Tenant::featureEnabled().
 *
 * Types marked available=false (e.g. restaurant) are visible-but-coming-soon.
 */
class BusinessTypes
{
    public const FEATURES = ['products', 'services', 'inventory', 'marketplace', 'reservations', 'delivery', 'expenses', 'images', 'pos', 'dine_in'];

    /**
     * @return array<string, array{
     *   label: string, examples: string[], available: bool,
     *   features: array<string,bool>,
     *   product_categories: string[], expense_categories: string[]
     * }>
     */
    public static function all(): array
    {
        return [
            'retail' => [
                'label' => 'Retail Store',
                'examples' => ['Garments', 'Shoes', 'Electronics', 'Cosmetics', 'Toys', 'Mobile Accessories', 'Gift Shop', 'Sports'],
                'available' => true,
                'features' => ['products' => true, 'services' => false, 'inventory' => true, 'marketplace' => true, 'reservations' => true, 'delivery' => true],
                'product_categories' => ['General'],
                'expense_categories' => ['Rent', 'Electricity', 'Internet', 'Staff Salary', 'Packaging', 'Marketing', 'Transportation', 'Cleaning', 'Miscellaneous'],
            ],
            'grocery' => [
                'label' => 'Grocery & General Store',
                'examples' => ['Grocery', 'Supermarket', 'Mini Mart', 'Convenience Store'],
                'available' => true,
                'features' => ['products' => true, 'services' => false, 'inventory' => true, 'marketplace' => true, 'reservations' => true, 'delivery' => true],
                'product_categories' => ['Food & Beverages', 'Household', 'Personal Care', 'Snacks', 'Dairy'],
                'expense_categories' => ['Supplier Purchases', 'Packaging', 'Delivery', 'Utilities', 'Rent', 'Staff Salary', 'Spoilage/Wastage'],
            ],
            'pharmacy' => [
                'label' => 'Pharmacy',
                'examples' => ['Medical Store', 'Pharmacy'],
                'available' => true,
                'features' => ['products' => true, 'services' => false, 'inventory' => true, 'marketplace' => false, 'reservations' => false, 'delivery' => true],
                'product_categories' => ['Medicines', 'Supplements', 'Medical Supplies', 'Baby Care', 'Personal Care'],
                'expense_categories' => ['Medicine Purchase', 'Refrigerator Electricity', 'Staff Salary', 'Licensing', 'Rent'],
            ],
            'clinic' => [
                'label' => 'Clinic / Medical Practice',
                'examples' => ['Clinic', 'Doctor', 'Dental', 'Physiotherapy', 'Diagnostic Lab', 'Veterinary'],
                'available' => true,
                // A clinic sells BOTH: medicines/supplies (stock-tracked products
                // with Rx + expiry) AND consultations/procedures (services, booked
                // as appointments). No online storefront.
                'features' => ['products' => true, 'services' => true, 'inventory' => true, 'marketplace' => false, 'reservations' => true, 'delivery' => false],
                'product_categories' => ['Consultations', 'Procedures', 'Medicines', 'Medical Supplies', 'Tests'],
                'expense_categories' => ['Medicine Purchase', 'Medical Supplies', 'Equipment', 'Staff Salary', 'Licensing', 'Rent', 'Utilities'],
            ],
            'salon' => [
                'label' => 'Salon & Beauty',
                'examples' => ['Salon', 'Barber', 'Spa', 'Beauty Clinic'],
                'available' => true,
                'features' => ['products' => true, 'services' => true, 'inventory' => false, 'marketplace' => false, 'reservations' => false, 'delivery' => false],
                'product_categories' => ['Hair Services', 'Skin Services', 'Retail Products'],
                'expense_categories' => ['Beauty Supplies', 'Equipment Maintenance', 'Staff Commission', 'Rent', 'Marketing', 'Utilities'],
            ],
            'workshop' => [
                'label' => 'Workshop / Auto Repair',
                'examples' => ['Bike Workshop', 'Car Workshop', 'Mechanic'],
                'available' => true,
                'features' => ['products' => true, 'services' => true, 'inventory' => true, 'marketplace' => false, 'reservations' => false, 'delivery' => false],
                'product_categories' => ['Spare Parts', 'Oils & Fluids', 'Services'],
                'expense_categories' => ['Parts Purchase', 'Tools & Equipment', 'Staff Salary', 'Rent', 'Utilities'],
            ],
            'service' => [
                'label' => 'Service Business',
                'examples' => ['Computer Repair', 'Mobile Repair', 'Printing', 'Tailor', 'Laundry'],
                'available' => true,
                'features' => ['products' => false, 'services' => true, 'inventory' => false, 'marketplace' => false, 'reservations' => false, 'delivery' => false],
                'product_categories' => ['Services'],
                'expense_categories' => ['Supplies', 'Equipment Maintenance', 'Staff Salary', 'Rent', 'Utilities', 'Marketing'],
            ],
            'wholesale' => [
                'label' => 'Wholesale Business',
                'examples' => ['Wholesale Distributor'],
                'available' => true,
                'features' => ['products' => true, 'services' => false, 'inventory' => true, 'marketplace' => true, 'reservations' => false, 'delivery' => true],
                'product_categories' => ['General Stock'],
                'expense_categories' => ['Bulk Purchases', 'Warehouse Rent', 'Transportation', 'Staff Salary', 'Utilities'],
            ],
            'books' => [
                'label' => 'Book & Stationery Store',
                'examples' => ['Bookshop', 'Stationery'],
                'available' => true,
                'features' => ['products' => true, 'services' => false, 'inventory' => true, 'marketplace' => true, 'reservations' => true, 'delivery' => true],
                'product_categories' => ['Books', 'Stationery', 'Office Supplies', 'Art Supplies'],
                'expense_categories' => ['Stock Purchase', 'Rent', 'Staff Salary', 'Utilities', 'Packaging'],
            ],
            'hardware' => [
                'label' => 'Hardware Store',
                'examples' => ['Hardware', 'Building Materials'],
                'available' => true,
                'features' => ['products' => true, 'services' => false, 'inventory' => true, 'marketplace' => true, 'reservations' => true, 'delivery' => true],
                'product_categories' => ['Tools', 'Plumbing', 'Electrical', 'Paint', 'Building Materials'],
                'expense_categories' => ['Stock Purchase', 'Transportation', 'Rent', 'Staff Salary', 'Utilities'],
            ],
            'restaurant' => [
                'label' => 'Restaurant / Food',
                'examples' => ['Pizza', 'Fast Food', 'Restaurant', 'Cafe', 'Bakery', 'Cloud Kitchen'],
                'available' => true,
                // Menu items are products WITHOUT stock tracking; sells online
                // with delivery. Dine-in (tables + KOT + split-bill) is on by
                // default for restaurants — a cloud kitchen can switch it off.
                'features' => ['products' => true, 'services' => false, 'inventory' => false, 'marketplace' => true, 'reservations' => false, 'delivery' => true, 'dine_in' => true],
                'product_categories' => ['Pizzas', 'Burgers', 'Starters', 'Deals', 'Beverages', 'Desserts'],
                'expense_categories' => ['Ingredients', 'Cooking Gas', 'Staff Salary', 'Rent', 'Cleaning', 'Packaging', 'Delivery', 'Utilities'],
            ],
        ];
    }

    public static function codes(bool $availableOnly = true): array
    {
        $all = self::all();

        return array_keys($availableOnly
            ? array_filter($all, fn ($t) => $t['available'])
            : $all);
    }

    public static function get(string $code): ?array
    {
        return self::all()[$code] ?? null;
    }

    public static function defaultFeatures(string $code): array
    {
        $features = self::get($code)['features'] ?? array_fill_keys(self::FEATURES, false);

        // Expense Manager defaults ON for every type (admin-controlled).
        // Product Images default to whatever the type's marketplace default is:
        // online-selling types get images (customers must see what they buy),
        // walk-in-only types (pharmacy, salon…) start image-free for a neat
        // form. Selling online always forces images on — see Tenant::imagesEnabled().
        return array_merge([
            'expenses' => true,
            'images' => $features['marketplace'] ?? false,
            // The in-shop POS till defaults ON for every type; the plan
            // ultimately decides (an Online-Business-only plan has no POS).
            'pos' => true,
        ], $features);
    }

    /**
     * The catalog item types a given business may create — derived from the
     * type + its feature flags. Restaurants sell food (plus retail drinks),
     * pharmacies sell medicine (plus retail), service shops sell services,
     * everyone else sells physical products.
     */
    public static function itemTypesFor(string $code): array
    {
        $t = self::get($code);
        if ($t === null) {
            return [ItemTypes::PHYSICAL];
        }

        $types = [];
        if ($code === 'restaurant') {
            $types[] = ItemTypes::FOOD;
        }
        if (in_array($code, ['pharmacy', 'clinic'], true)) {
            $types[] = ItemTypes::MEDICINE;
        }
        if (! empty($t['features']['products'])) {
            $types[] = ItemTypes::PHYSICAL;
        }
        if (! empty($t['features']['services'])) {
            $types[] = ItemTypes::SERVICE;
        }
        // Combo/deal bundles — for shops that run deals: restaurants, grocery,
        // retail. (A deal bundles existing products at one price.)
        if (in_array($code, ['restaurant', 'grocery', 'retail'], true)) {
            $types[] = ItemTypes::DEAL;
        }

        return array_values(array_unique($types)) ?: [ItemTypes::PHYSICAL];
    }
}
