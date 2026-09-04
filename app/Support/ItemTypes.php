<?php

namespace App\Support;

/**
 * Item-type capability engine — the spine of the universal catalog.
 *
 * Every catalog Item carries an `item_type`. The type unlocks a fixed set of
 * capabilities (inventory / variants / modifiers / add-ons / POS / marketplace)
 * so one Item model serves shops, restaurants, pharmacies and service
 * businesses without any per-business-type hardcoding.
 *
 *   Item Type        Inventory  Variants  Modifiers  Add-ons  POS  Marketplace
 *   physical_product  required    yes        no        yes    yes     yes
 *   food_item         optional    yes        yes       yes    yes     yes
 *   medicine          required    yes        no        no     yes     yes
 *   service           never       opt        no        no     opt     yes
 *
 * `inventory`: required | optional | never — governs whether stock is tracked
 * and whether the "track stock" toggle is offered.
 * `variants`/`pos`: true | false | 'optional' — 'optional' means the UI offers
 * it but it is off by default.
 *
 * The coarse App\Enums\ItemType (product|service) still drives stock/sale
 * plumbing; item_type is the richer classification derived on top of it.
 */
class ItemTypes
{
    public const PHYSICAL = 'physical_product';

    public const FOOD = 'food_item';

    public const MEDICINE = 'medicine';

    public const SERVICE = 'service';

    public const DEAL = 'deal';

    public const CAPABILITIES = ['inventory', 'variants', 'modifiers', 'addons', 'pos', 'marketplace', 'combo'];

    /**
     * @return array<string, array{
     *   label: string, coarse: string,
     *   inventory: string, variants: bool|string, modifiers: bool,
     *   addons: bool, pos: bool|string, marketplace: bool
     * }>
     */
    public static function all(): array
    {
        return [
            self::PHYSICAL => [
                'label' => 'Physical Product',
                'coarse' => 'product',
                'inventory' => 'required',
                'variants' => true,
                'modifiers' => false,
                'addons' => true,
                'pos' => true,
                'marketplace' => true,
            ],
            self::FOOD => [
                'label' => 'Food Item',
                'coarse' => 'product',
                'inventory' => 'optional',
                'variants' => true,
                'modifiers' => true,
                'addons' => true,
                'pos' => true,
                'marketplace' => true,
            ],
            self::MEDICINE => [
                'label' => 'Medicine',
                'coarse' => 'product',
                'inventory' => 'required',
                'variants' => true,
                'modifiers' => false,
                'addons' => false,
                'pos' => true,
                'marketplace' => true,
            ],
            self::SERVICE => [
                'label' => 'Service',
                'coarse' => 'service',
                'inventory' => 'never',
                'variants' => 'optional',
                'modifiers' => false,
                'addons' => false,
                'pos' => 'optional',
                'marketplace' => true,
            ],
            // A combo/deal: a fixed bundle of other items at one price. It holds
            // no stock of its own — selling it draws down each component's stock.
            self::DEAL => [
                'label' => 'Combo / Deal',
                'coarse' => 'product',
                'inventory' => 'never',
                'variants' => false,
                'modifiers' => false,
                'addons' => false,
                'pos' => true,
                'marketplace' => true,
                'combo' => true,
            ],
        ];
    }

    public static function codes(): array
    {
        return array_keys(self::all());
    }

    public static function get(string $code): ?array
    {
        return self::all()[$code] ?? null;
    }

    public static function exists(string $code): bool
    {
        return isset(self::all()[$code]);
    }

    /** The coarse product|service value the stock/sale plumbing keys on. */
    public static function coarse(string $itemType): string
    {
        return self::get($itemType)['coarse'] ?? 'product';
    }

    /** Whether an item of this type supports a capability at all (not 'never'/false). */
    public static function supports(string $itemType, string $capability): bool
    {
        $value = self::get($itemType)[$capability] ?? false;

        return $value !== false && $value !== 'never';
    }

    /** Whether stock tracking is even possible for this item type. */
    public static function canTrackInventory(string $itemType): bool
    {
        return (self::get($itemType)['inventory'] ?? 'never') !== 'never';
    }

    /** Default track_inventory for a fresh item of this type (before overrides). */
    public static function defaultTracksInventory(string $itemType): bool
    {
        return (self::get($itemType)['inventory'] ?? 'never') === 'required';
    }
}
