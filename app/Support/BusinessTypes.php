<?php

namespace App\Support;

/**
 * Business-type registry — the core of ShopOS's business-type awareness.
 *
 * NOTHING in the platform is hardcoded to retail. A tenant's selected type
 * determines:
 *   - feature defaults (marketplace, reservations, delivery, inventory, services)
 *   - default product/service categories (template, fully editable after)
 *   - default expense categories (template, fully editable after)
 *   - the finer `categories` a tenant picks WITHIN the type (its business_category)
 *
 * A type PROPOSES modules; it does not grant them. What a tenant can actually
 * do is its own module map (Tenant::featureEnabled), set from this proposal
 * when the admin creates it and adjustable afterwards. Plans have no say —
 * see Modules and PlanLimits for why that split exists.
 *
 * === The primary types ===
 * The core five are food, mart, pharmacy, retail and services, plus three that
 * exist because no combination of the five describes them: automotive (goods
 * AND labour on one invoice, with stock behind it), petroleum (a forecourt
 * measured by meter and dip) and finance (books only, no catalog or till).
 *
 * The finer distinction (garments vs electronics, tyre shop vs auto parts,
 * restaurant vs bakery) is the tenant's `business_category`, chosen from the
 * type's `categories` list — a new type is only ever added when the FEATURE
 * defaults differ, never merely because the trade has a different name.
 *
 * Older narrower codes (grocery, clinic, salon, workshop, service, wholesale,
 * books, hardware, restaurant) are kept as `legacy` entries: they still resolve
 * for existing tenants, demo data and imports, but are hidden from the picker
 * (BusinessTypeController drops `legacy`). Most have been absorbed as a
 * category of one of the five.
 */
class BusinessTypes
{
    public const FEATURES = ['products', 'services', 'inventory', 'marketplace', 'reservations', 'delivery', 'expenses', 'images', 'pos', 'dine_in', 'fuel'];

    /**
     * Selling units suggested per type (the product/POS unit field offers
     * these; the merchant can still type their own). Part of the Business Type
     * Engine — a pharmacy talks in strips and tablets, a grocery in kg and
     * litres, a diner in plates.
     */
    private const UNITS = [
        'food' => ['Plate', 'Piece', 'Glass', 'Cup', 'Bowl', 'Bottle', 'Slice', 'Pack', 'Dozen'],
        'mart' => ['Piece', 'Pack', 'KG', 'Gram', 'Litre', 'ml', 'Dozen', 'Box', 'Bag', 'Bottle', 'Can'],
        'pharmacy' => ['Tablet', 'Capsule', 'Strip', 'Bottle', 'Tube', 'Injection', 'Sachet', 'ml', 'Gram', 'Box'],
        'retail' => ['Piece', 'Pair', 'Box', 'Set', 'Pack', 'Roll', 'Meter', 'Dozen'],
        'services' => ['Service', 'Session', 'Hour', 'Visit', 'Job'],
        // A tyre shop sells by the tyre and by the set of four, a battery
        // shop by the piece, and the bay bills labour as a job.
        'automotive' => ['Piece', 'Set', 'Pair', 'Litre', 'Job', 'Hour', 'Service', 'Box', 'Pack'],
        // Fuel sells by the litre; lubricants by bottle/can/drum; the forecourt
        // mart in pieces; the wash/service bay as a job.
        'petroleum' => ['Litre', 'ml', 'Bottle', 'Can', 'Drum', 'Piece', 'Pack', 'KG', 'Service'],
    ];

    /** Variant attribute names suggested per type (the variant editor hints these). */
    private const VARIANT_ATTRIBUTES = [
        'food' => ['Size', 'Flavor'],
        'mart' => ['Weight', 'Volume', 'Pack Size'],
        'pharmacy' => ['Strength', 'Pack Size'],
        'retail' => ['Size', 'Color', 'Material', 'Storage', 'Model'],
        'services' => ['Package', 'Duration'],
        'petroleum' => ['Grade', 'Viscosity', 'Volume'],
        // How a tyre is actually asked for across a counter: "185/65 R15".
        'automotive' => ['Size', 'Brand', 'Load Rating', 'Ampere', 'Model'],
    ];

    /**
     * Legacy code → the primary type it became.
     *
     * This is the ONE place a narrow old code is translated, and everything
     * type-shaped goes through primary(): units, variant attributes, catalog
     * item types, and the trade-specific screens the panel offers. Before it
     * did, a `clinic` tenant kept working but was quietly missing the chemist's
     * register, and a `workshop` the vehicle register — each gate named the
     * eight current codes and nothing resolved the older ones.
     *
     * `workshop` maps to automotive, not services: its module set (products +
     * services + inventory, sold at the shop) is automotive's exactly, and a
     * mechanic wants the plate register and part-shaped units far more than a
     * public portfolio.
     */
    private const LEGACY_PRIMARY = [
        'restaurant' => 'food', 'grocery' => 'mart', 'clinic' => 'pharmacy',
        'salon' => 'services', 'workshop' => 'automotive', 'service' => 'services',
        'wholesale' => 'retail', 'books' => 'retail', 'hardware' => 'retail',
    ];

    private const DEFAULT_UNITS = ['Piece', 'Pack', 'Box', 'KG', 'Gram', 'Litre', 'ml', 'Dozen'];

    /** Fields a product MUST carry once it's shown online (marketplace-visible). */
    public const ONLINE_REQUIRED_FIELDS = ['image', 'description'];

    /**
     * @return array<string, array{
     *   label: string, examples: string[], available: bool,
     *   features: array<string,bool>,
     *   product_categories: string[], expense_categories: string[],
     *   categories?: array<int, array{value:string,label:string}>,
     *   legacy?: bool
     * }>
     */
    public static function all(): array
    {
        return [
            // ── The primary, selectable types ─────────────────────────────
            'food' => [
                'label' => 'Food & Restaurant',
                'examples' => ['Restaurant', 'Fast Food', 'Cafe', 'Bakery', 'Cloud Kitchen', 'Sweets', 'Juice Bar'],
                'available' => true,
                // Menu items are products WITHOUT stock tracking; sells online
                // with delivery. Dine-in (tables + KOT + split-bill) defaults on
                // — a cloud kitchen can switch it off.
                'features' => ['products' => true, 'services' => false, 'inventory' => false, 'marketplace' => true, 'reservations' => false, 'delivery' => true, 'dine_in' => true],
                'product_categories' => ['Starters', 'Main Course', 'Deals', 'Beverages', 'Desserts'],
                'expense_categories' => ['Ingredients', 'Cooking Gas', 'Staff Salary', 'Rent', 'Cleaning', 'Packaging', 'Delivery', 'Utilities'],
                'categories' => [
                    ['value' => 'restaurant', 'label' => 'Restaurant'],
                    ['value' => 'fast_food', 'label' => 'Fast Food'],
                    ['value' => 'cafe', 'label' => 'Cafe / Tea'],
                    ['value' => 'bakery', 'label' => 'Bakery & Sweets'],
                    ['value' => 'cloud_kitchen', 'label' => 'Cloud Kitchen'],
                    ['value' => 'juice_corner', 'label' => 'Juice / Shakes'],
                    ['value' => 'home_kitchen', 'label' => 'Home Kitchen'],
                ],
            ],
            'mart' => [
                'label' => 'Mart & Grocery',
                'examples' => ['Grocery', 'Supermarket', 'General Store', 'Mini Mart', 'Convenience Store'],
                'available' => true,
                'features' => ['products' => true, 'services' => false, 'inventory' => true, 'marketplace' => true, 'reservations' => false, 'delivery' => true],
                'product_categories' => ['Food & Beverages', 'Household', 'Personal Care', 'Snacks', 'Dairy'],
                'expense_categories' => ['Supplier Purchases', 'Packaging', 'Delivery', 'Utilities', 'Rent', 'Staff Salary', 'Spoilage/Wastage'],
                'categories' => [
                    ['value' => 'grocery', 'label' => 'Grocery Store'],
                    ['value' => 'supermarket', 'label' => 'Supermarket'],
                    ['value' => 'general_store', 'label' => 'General Store'],
                    ['value' => 'mini_mart', 'label' => 'Mini Mart'],
                    ['value' => 'convenience_store', 'label' => 'Convenience Store'],
                    ['value' => 'dairy_shop', 'label' => 'Dairy Shop'],
                ],
            ],
            'pharmacy' => [
                'label' => 'Pharmacy & Medical',
                'examples' => ['Medical Store', 'Pharmacy', 'Surgical Store'],
                'available' => true,
                'features' => ['products' => true, 'services' => false, 'inventory' => true, 'marketplace' => false, 'reservations' => false, 'delivery' => true],
                'product_categories' => ['Medicines', 'Supplements', 'Medical Supplies', 'Baby Care', 'Personal Care'],
                'expense_categories' => ['Medicine Purchase', 'Refrigerator Electricity', 'Staff Salary', 'Licensing', 'Rent'],
                'categories' => [
                    ['value' => 'medical_store', 'label' => 'Medical Store'],
                    ['value' => 'surgical', 'label' => 'Surgical Store'],
                    ['value' => 'homeopathic', 'label' => 'Homeopathic'],
                    ['value' => 'clinic_pharmacy', 'label' => 'Clinic Pharmacy'],
                ],
            ],
            'retail' => [
                'label' => 'Retail Store',
                'examples' => ['Garments', 'Shoes', 'Electronics', 'Cosmetics', 'Mobile Accessories', 'Hardware', 'Books', 'Gift Shop'],
                'available' => true,
                'features' => ['products' => true, 'services' => false, 'inventory' => true, 'marketplace' => true, 'reservations' => true, 'delivery' => true],
                'product_categories' => ['General'],
                'expense_categories' => ['Rent', 'Electricity', 'Internet', 'Staff Salary', 'Packaging', 'Marketing', 'Transportation', 'Cleaning', 'Miscellaneous'],
                'categories' => [
                    ['value' => 'garments', 'label' => 'Garments & Clothing'],
                    ['value' => 'footwear', 'label' => 'Footwear'],
                    ['value' => 'electronics', 'label' => 'Electronics'],
                    ['value' => 'mobile_accessories', 'label' => 'Mobile & Accessories'],
                    ['value' => 'cosmetics', 'label' => 'Cosmetics'],
                    ['value' => 'toys', 'label' => 'Toys'],
                    ['value' => 'gifts', 'label' => 'Gift Shop'],
                    ['value' => 'sports', 'label' => 'Sports'],
                    ['value' => 'books_stationery', 'label' => 'Books & Stationery'],
                    ['value' => 'hardware', 'label' => 'Hardware & Tools'],
                    ['value' => 'jewellery', 'label' => 'Jewellery'],
                    ['value' => 'home_appliances', 'label' => 'Home & Appliances'],
                    ['value' => 'wholesale', 'label' => 'Wholesale / Distributor'],
                    ['value' => 'general', 'label' => 'General / Other'],
                ],
            ],
            'services' => [
                'label' => 'Services',
                'examples' => ['Salon', 'Barber', 'Spa', 'Mobile Repair', 'Computer Repair', 'Auto Workshop', 'Tailor', 'Laundry', 'Printing'],
                'available' => true,
                // A service business lists what it does; customers can view and
                // contact. Products/inventory stay OFF by default (a workshop or
                // salon that also sells parts/retail turns them on per-tenant).
                // Reservations stay OFF too: today's reservation engine holds
                // PRODUCT stock — it can't book appointments, so defaulting it
                // on for services would show a feature they can't use. Flips on
                // when the appointments add-on lands (or per-tenant for one
                // that also sells reservable products).
                'features' => ['products' => false, 'services' => true, 'inventory' => false, 'marketplace' => false, 'reservations' => false, 'delivery' => false],
                'product_categories' => ['Services', 'Packages', 'Retail Products'],
                'expense_categories' => ['Supplies', 'Equipment Maintenance', 'Staff Salary', 'Rent', 'Utilities', 'Marketing'],
                'categories' => [
                    ['value' => 'salon_beauty', 'label' => 'Salon & Beauty'],
                    ['value' => 'barber', 'label' => 'Barber'],
                    ['value' => 'spa', 'label' => 'Spa'],
                    ['value' => 'mobile_repair', 'label' => 'Mobile Repair'],
                    ['value' => 'computer_repair', 'label' => 'Computer Repair'],
                    ['value' => 'auto_workshop', 'label' => 'Auto Workshop'],
                    ['value' => 'tailor', 'label' => 'Tailor'],
                    ['value' => 'laundry', 'label' => 'Laundry'],
                    ['value' => 'printing', 'label' => 'Printing'],
                    ['value' => 'photography', 'label' => 'Photography'],
                    ['value' => 'clinic', 'label' => 'Clinic / Practice'],
                    ['value' => 'other', 'label' => 'Other Service'],
                ],
            ],

            'automotive' => [
                'label' => 'Auto & Tyre',
                'examples' => ['Tyre Shop', 'Battery Shop', 'Auto Workshop', 'Oil Change', 'Denting & Painting', 'Auto Parts', 'Car Wash', 'AC Service'],
                'available' => true,
                // The auto aftermarket is neither a petrol pump nor plain
                // retail, and forcing it into either loses half the business:
                // `retail` has no services, so fitting, balancing and alignment
                // — which is where a tyre shop's margin actually is — could not
                // be billed at all; `services` has no products or stock, so the
                // tyres themselves couldn't be counted. This type is the one
                // combination those shops need: goods AND labour on one
                // invoice, with stock behind it. Sold at the shop, not online,
                // so marketplace/delivery stay off.
                'features' => ['products' => true, 'services' => true, 'inventory' => true, 'marketplace' => false, 'reservations' => false, 'delivery' => false],
                'product_categories' => ['Tyres', 'Tubes & Rims', 'Batteries', 'Lubricants & Oils', 'Spare Parts', 'Accessories', 'Labour & Services'],
                'expense_categories' => ['Stock Purchase', 'Workshop Tools', 'Staff Salary', 'Rent', 'Electricity', 'Machinery Maintenance', 'Utilities', 'Scrap Disposal'],
                'categories' => [
                    ['value' => 'tyre_shop', 'label' => 'Tyre Shop'],
                    ['value' => 'battery_shop', 'label' => 'Battery Shop'],
                    ['value' => 'auto_parts', 'label' => 'Auto Parts Store'],
                    ['value' => 'auto_workshop', 'label' => 'Auto Workshop / Mechanic'],
                    ['value' => 'oil_change', 'label' => 'Oil Change & Lubrication'],
                    ['value' => 'denting_painting', 'label' => 'Denting & Painting'],
                    ['value' => 'ac_service', 'label' => 'Auto AC Service'],
                    ['value' => 'car_wash', 'label' => 'Car Wash & Detailing'],
                    ['value' => 'bike_workshop', 'label' => 'Motorcycle Workshop'],
                    ['value' => 'general_auto', 'label' => 'General / Other'],
                ],
            ],

            'finance' => [
                'label' => 'Finance Manager',
                'examples' => ['Office', 'Agency', 'Software House', 'Freelancer', 'Consultant', 'School', 'Clinic', 'NGO', 'Trader', 'Home Business'],
                'available' => true,
                // The books-only tenant: no catalog, no stock, no till. Someone
                // who buys ONLY the Expense/Income manager to answer "where is
                // my money going?". Everything is off except expenses — and
                // unlike every other type this one explicitly switches POS OFF:
                // defaultFeatures() merges the type's own flags LAST, so this
                // beats the platform-wide pos-on default.
                'features' => [
                    'products' => false, 'services' => false, 'inventory' => false,
                    'marketplace' => false, 'reservations' => false, 'delivery' => false,
                    'dine_in' => false, 'pos' => false, 'images' => false, 'expenses' => true,
                ],
                // No catalog to seed.
                'product_categories' => [],
                'expense_categories' => [
                    'Salary', 'Rent', 'Electricity', 'Gas', 'Water', 'Internet',
                    'Marketing', 'Fuel', 'Travel', 'Office Supplies', 'Maintenance',
                    'Repairs', 'Courier', 'Printing', 'Software & Subscriptions',
                    'Professional Fees', 'Tax', 'Insurance', 'Bank Charges', 'Miscellaneous',
                ],
                'categories' => [
                    ['value' => 'office', 'label' => 'Office / Company'],
                    ['value' => 'agency', 'label' => 'Agency'],
                    ['value' => 'software_house', 'label' => 'Software House'],
                    ['value' => 'freelancer', 'label' => 'Freelancer'],
                    ['value' => 'consultant', 'label' => 'Consultant'],
                    ['value' => 'school', 'label' => 'School / Academy'],
                    ['value' => 'clinic', 'label' => 'Clinic / Practice'],
                    ['value' => 'ngo', 'label' => 'NGO / Trust'],
                    ['value' => 'trader', 'label' => 'Trader / Distributor'],
                    ['value' => 'home_business', 'label' => 'Home Business'],
                    ['value' => 'other', 'label' => 'Other'],
                ],
            ],

            'petroleum' => [
                'label' => 'Petroleum & Energy',
                'examples' => ['Petrol Pump', 'CNG Station', 'Fuel Station', 'Lubricants Shop', 'Tyre Shop', 'Auto Service', 'Car Wash'],
                'available' => true,
                // A fuel station is an ecosystem: fuel (a volume-sold product) +
                // a forecourt mart + lubricants/oils + tyres/batteries +
                // accessories (all physical products), plus car wash / oil-change
                // / tyre-fitting (services). Products + services + inventory ON;
                // sold on the forecourt, not online, so marketplace/delivery OFF.
                // Each fuel department/pump is a Branch (see the multi-branch
                // model). The forecourt itself — tanks, meters, dips and the
                // shift that reconciles them — is the `fuel` module, on by
                // default here and off everywhere else: a tyre shop under this
                // type can switch it off and keep the rest.
                'features' => ['products' => true, 'services' => true, 'inventory' => true, 'marketplace' => false, 'reservations' => false, 'delivery' => false, 'fuel' => true],
                'product_categories' => ['Fuel', 'Lubricants & Oils', 'Convenience Store', 'Auto Accessories', 'Tyres & Batteries', 'Services'],
                'expense_categories' => ['Fuel Purchase', 'Tanker Delivery', 'Staff Salary', 'Rent', 'Electricity', 'Pump Maintenance', 'Licensing', 'Utilities'],
                'categories' => [
                    ['value' => 'petrol_pump', 'label' => 'Petrol Pump'],
                    ['value' => 'cng_station', 'label' => 'CNG Station'],
                    ['value' => 'diesel_station', 'label' => 'Diesel / HSD Station'],
                    ['value' => 'lubricants_shop', 'label' => 'Lubricants & Oil Shop'],
                    ['value' => 'tyre_shop', 'label' => 'Tyre & Battery Shop'],
                    ['value' => 'auto_service', 'label' => 'Auto Service Station'],
                    ['value' => 'car_wash', 'label' => 'Car Wash'],
                    ['value' => 'general_petroleum', 'label' => 'General / Other'],
                ],
            ],

            // ── Legacy codes (hidden from the picker; still resolve) ───────
            // Absorbed as a category of one of the five above. Kept intact so
            // existing tenants, demo data and imports keep working.
            'restaurant' => [
                'label' => 'Restaurant / Food',
                'examples' => ['Pizza', 'Fast Food', 'Restaurant', 'Cafe', 'Bakery', 'Cloud Kitchen'],
                'available' => false,
                'legacy' => true,
                'features' => ['products' => true, 'services' => false, 'inventory' => false, 'marketplace' => true, 'reservations' => false, 'delivery' => true, 'dine_in' => true],
                'product_categories' => ['Pizzas', 'Burgers', 'Starters', 'Deals', 'Beverages', 'Desserts'],
                'expense_categories' => ['Ingredients', 'Cooking Gas', 'Staff Salary', 'Rent', 'Cleaning', 'Packaging', 'Delivery', 'Utilities'],
            ],
            'grocery' => [
                'label' => 'Grocery & General Store',
                'examples' => ['Grocery', 'Supermarket', 'Mini Mart', 'Convenience Store'],
                'available' => false,
                'legacy' => true,
                'features' => ['products' => true, 'services' => false, 'inventory' => true, 'marketplace' => true, 'reservations' => true, 'delivery' => true],
                'product_categories' => ['Food & Beverages', 'Household', 'Personal Care', 'Snacks', 'Dairy'],
                'expense_categories' => ['Supplier Purchases', 'Packaging', 'Delivery', 'Utilities', 'Rent', 'Staff Salary', 'Spoilage/Wastage'],
            ],
            'clinic' => [
                'label' => 'Clinic / Medical Practice',
                'examples' => ['Clinic', 'Doctor', 'Dental', 'Physiotherapy', 'Diagnostic Lab', 'Veterinary'],
                'available' => false,
                'legacy' => true,
                'features' => ['products' => true, 'services' => true, 'inventory' => true, 'marketplace' => false, 'reservations' => true, 'delivery' => false],
                'product_categories' => ['Consultations', 'Procedures', 'Medicines', 'Medical Supplies', 'Tests'],
                'expense_categories' => ['Medicine Purchase', 'Medical Supplies', 'Equipment', 'Staff Salary', 'Licensing', 'Rent', 'Utilities'],
            ],
            'salon' => [
                'label' => 'Salon & Beauty',
                'examples' => ['Salon', 'Barber', 'Spa', 'Beauty Clinic'],
                'available' => false,
                'legacy' => true,
                'features' => ['products' => true, 'services' => true, 'inventory' => false, 'marketplace' => false, 'reservations' => false, 'delivery' => false],
                'product_categories' => ['Hair Services', 'Skin Services', 'Retail Products'],
                'expense_categories' => ['Beauty Supplies', 'Equipment Maintenance', 'Staff Commission', 'Rent', 'Marketing', 'Utilities'],
            ],
            'workshop' => [
                'label' => 'Workshop / Auto Repair',
                'examples' => ['Bike Workshop', 'Car Workshop', 'Mechanic'],
                'available' => false,
                'legacy' => true,
                'features' => ['products' => true, 'services' => true, 'inventory' => true, 'marketplace' => false, 'reservations' => false, 'delivery' => false],
                'product_categories' => ['Spare Parts', 'Oils & Fluids', 'Services'],
                'expense_categories' => ['Parts Purchase', 'Tools & Equipment', 'Staff Salary', 'Rent', 'Utilities'],
            ],
            'service' => [
                'label' => 'Service Business',
                'examples' => ['Computer Repair', 'Mobile Repair', 'Printing', 'Tailor', 'Laundry'],
                'available' => false,
                'legacy' => true,
                'features' => ['products' => false, 'services' => true, 'inventory' => false, 'marketplace' => false, 'reservations' => false, 'delivery' => false],
                'product_categories' => ['Services'],
                'expense_categories' => ['Supplies', 'Equipment Maintenance', 'Staff Salary', 'Rent', 'Utilities', 'Marketing'],
            ],
            'wholesale' => [
                'label' => 'Wholesale Business',
                'examples' => ['Wholesale Distributor'],
                'available' => false,
                'legacy' => true,
                'features' => ['products' => true, 'services' => false, 'inventory' => true, 'marketplace' => true, 'reservations' => false, 'delivery' => true],
                'product_categories' => ['General Stock'],
                'expense_categories' => ['Bulk Purchases', 'Warehouse Rent', 'Transportation', 'Staff Salary', 'Utilities'],
            ],
            'books' => [
                'label' => 'Book & Stationery Store',
                'examples' => ['Bookshop', 'Stationery'],
                'available' => false,
                'legacy' => true,
                'features' => ['products' => true, 'services' => false, 'inventory' => true, 'marketplace' => true, 'reservations' => true, 'delivery' => true],
                'product_categories' => ['Books', 'Stationery', 'Office Supplies', 'Art Supplies'],
                'expense_categories' => ['Stock Purchase', 'Rent', 'Staff Salary', 'Utilities', 'Packaging'],
            ],
            'hardware' => [
                'label' => 'Hardware Store',
                'examples' => ['Hardware', 'Building Materials'],
                'available' => false,
                'legacy' => true,
                'features' => ['products' => true, 'services' => false, 'inventory' => true, 'marketplace' => true, 'reservations' => true, 'delivery' => true],
                'product_categories' => ['Tools', 'Plumbing', 'Electrical', 'Paint', 'Building Materials'],
                'expense_categories' => ['Stock Purchase', 'Transportation', 'Rent', 'Staff Salary', 'Utilities'],
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

    /** The categories a tenant may pick within a type (its business_category). */
    public static function categoriesFor(string $code): array
    {
        return self::get($code)['categories'] ?? [];
    }

    /**
     * The current type a code stands for. A primary code is its own primary;
     * a legacy one resolves to what it was absorbed into; an unknown code is
     * returned untouched so nothing is invented for it.
     *
     * Anything deciding what a business IS — units, variant hints, item types,
     * the trade screens in the sidebar — must ask this rather than compare
     * against the eight current codes, or old tenants silently lose features
     * they are entitled to.
     */
    public static function primary(string $code): string
    {
        return self::LEGACY_PRIMARY[$code] ?? $code;
    }

    /** Suggested selling units for a type (legacy codes map to their primary). */
    public static function unitsFor(string $code): array
    {
        return self::UNITS[self::primary($code)] ?? self::DEFAULT_UNITS;
    }

    /** Suggested variant attribute names for a type (Size/Color, Strength/Pack…). */
    public static function variantAttributesFor(string $code): array
    {
        return self::VARIANT_ATTRIBUTES[self::primary($code)] ?? ['Size', 'Color'];
    }

    /**
     * Default INCOME categories seeded on setup. Deliberately type-independent:
     * these are NON-sales "other income" buckets (sales revenue is derived by
     * the Cashbook, never entered here), and they mean the same across a shop,
     * a clinic or a restaurant.
     *
     * @return list<string>
     */
    public static function defaultIncomeCategories(): array
    {
        return [
            'Other Income',
            'Owner Investment',
            'Supplier Refund',
            'Interest',
            'Rent Received',
        ];
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
     * type + its feature flags. Food shops sell food (plus retail drinks),
     * pharmacies sell medicine (plus retail), service shops sell services,
     * everyone else sells physical products.
     */
    public static function itemTypesFor(string $code): array
    {
        $t = self::get($code);
        if ($t === null) {
            return [ItemTypes::PHYSICAL];
        }

        // Legacy codes answer as the type they became, so a `clinic` may still
        // stock medicine and a `restaurant` still write a menu.
        $primary = self::primary($code);

        $types = [];
        if ($primary === 'food') {
            $types[] = ItemTypes::FOOD;
        }
        if ($primary === 'pharmacy') {
            $types[] = ItemTypes::MEDICINE;
        }
        if (! empty($t['features']['products'])) {
            $types[] = ItemTypes::PHYSICAL;
        }
        if (! empty($t['features']['services'])) {
            $types[] = ItemTypes::SERVICE;
        }
        // Combo/deal bundles — for shops that run deals: food, mart, retail
        // (and their legacy equivalents). A deal bundles existing products at
        // one price.
        if (in_array($primary, ['food', 'mart', 'retail'], true)) {
            $types[] = ItemTypes::DEAL;
        }

        // A KNOWN type that sells neither products nor services (finance /
        // books-only) legitimately has NO item types — it must not be handed a
        // physical fallback, or its catalog editor would offer items it can
        // never sell. Unknown codes already returned physical above.
        if (empty($t['features']['products']) && empty($t['features']['services'])) {
            return array_values(array_unique($types));
        }

        return array_values(array_unique($types)) ?: [ItemTypes::PHYSICAL];
    }
}
