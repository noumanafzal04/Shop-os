<?php

namespace Tests\Feature;

use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * The Business Type Engine: each type declares its own selling units, variant
 * attribute suggestions, and online-required fields — surfaced to the product
 * form so a pharmacy talks in strips and a diner in plates, without hard-coded
 * per-type UI.
 */
class BusinessTypeEngineTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    // ── Registry helpers ─────────────────────────────────────────────

    public function test_units_are_type_specific(): void
    {
        $this->assertContains('Plate', BusinessTypes::unitsFor('food'));
        $this->assertContains('Strip', BusinessTypes::unitsFor('pharmacy'));
        $this->assertContains('Tablet', BusinessTypes::unitsFor('pharmacy'));
        $this->assertContains('KG', BusinessTypes::unitsFor('mart'));
        $this->assertContains('Pair', BusinessTypes::unitsFor('retail'));
        $this->assertContains('Session', BusinessTypes::unitsFor('services'));
    }

    public function test_variant_attributes_are_type_specific(): void
    {
        $this->assertContains('Color', BusinessTypes::variantAttributesFor('retail'));
        $this->assertContains('Storage', BusinessTypes::variantAttributesFor('retail'));
        $this->assertContains('Strength', BusinessTypes::variantAttributesFor('pharmacy'));
        $this->assertContains('Flavor', BusinessTypes::variantAttributesFor('food'));
    }

    public function test_legacy_codes_inherit_their_primary_type(): void
    {
        // restaurant → food, grocery → mart, salon → services.
        $this->assertSame(BusinessTypes::unitsFor('food'), BusinessTypes::unitsFor('restaurant'));
        $this->assertContains('KG', BusinessTypes::unitsFor('grocery'));
        $this->assertContains('Weight', BusinessTypes::variantAttributesFor('grocery'));
        $this->assertContains('Session', BusinessTypes::unitsFor('salon'));
    }

    public function test_unknown_type_falls_back_to_generic_units(): void
    {
        $units = BusinessTypes::unitsFor('does-not-exist');
        $this->assertContains('Piece', $units);
        $this->assertContains('KG', $units);
    }

    // ── API surface (public onboarding lookups) ──────────────────────

    public function test_business_types_endpoint_exposes_units_and_variant_attributes(): void
    {
        $data = $this->getJson('/api/v1/business-types')->assertOk()->json('data');

        $pharmacy = collect($data)->firstWhere('code', 'pharmacy');
        $this->assertContains('Strip', $pharmacy['units']);
        $this->assertContains('Strength', $pharmacy['variant_attributes']);

        $food = collect($data)->firstWhere('code', 'food');
        $this->assertContains('Plate', $food['units']);
    }

    public function test_item_types_endpoint_declares_online_required_fields(): void
    {
        $data = $this->getJson('/api/v1/item-types')->assertOk()->json('data');

        $physical = collect($data)->firstWhere('code', 'physical_product');
        // A marketplace-capable item must complete image + description online.
        $this->assertEqualsCanonicalizing(['image', 'description'], $physical['online_required']);
    }

    // ── Petroleum & Energy ───────────────────────────────────────────

    public function test_petroleum_units_and_variant_attributes(): void
    {
        $this->assertContains('Litre', BusinessTypes::unitsFor('petroleum'));
        $this->assertContains('Drum', BusinessTypes::unitsFor('petroleum'));
        $this->assertContains('Grade', BusinessTypes::variantAttributesFor('petroleum'));
        $this->assertContains('Viscosity', BusinessTypes::variantAttributesFor('petroleum'));
    }

    public function test_petroleum_defaults_products_services_inventory_on_marketplace_off(): void
    {
        $f = BusinessTypes::defaultFeatures('petroleum');

        $this->assertTrue($f['products']);
        $this->assertTrue($f['services']);   // car wash / oil change / tyre fitting
        $this->assertTrue($f['inventory']);
        $this->assertFalse($f['marketplace']); // sold on the forecourt, not online
        $this->assertFalse($f['delivery']);
        $this->assertTrue($f['expenses']);
        $this->assertTrue($f['pos']);
        // marketplace off → images not forced on by default.
        $this->assertFalse($f['images']);
    }

    public function test_petroleum_can_sell_both_physical_products_and_services(): void
    {
        $types = BusinessTypes::itemTypesFor('petroleum');

        // Fuel + lubricants + accessories are physical; the wash/service bay is a service.
        $this->assertContains('physical_product', $types);
        $this->assertContains('service', $types);
    }

    public function test_petroleum_is_a_selectable_onboarding_type(): void
    {
        $data = $this->getJson('/api/v1/business-types')->assertOk()->json('data');

        $petroleum = collect($data)->firstWhere('code', 'petroleum');
        $this->assertNotNull($petroleum);
        $this->assertSame('Petroleum & Energy', $petroleum['label']);
        $this->assertTrue($petroleum['available']);
        $this->assertContains('Litre', $petroleum['units']);
        $this->assertContains('physical_product', $petroleum['item_types']);
        $this->assertContains('service', $petroleum['item_types']);
        // Its business_category picklist is exposed.
        $this->assertContains('petrol_pump', collect($petroleum['categories'])->pluck('value')->all());
    }

    // ── A restaurant keeps a store room; a juice corner does not ────
    //
    // `food` defaults to inventory OFF, and for half of what it covers that is
    // right: a juice corner buys fruit at the mandi every morning for cash, and
    // a home kitchen is one person cooking. For the other half it is wrong in
    // the expensive direction — a restaurant, bakery or cloud kitchen buys on a
    // running supplier account and lives on food cost, and the inventory module
    // is what carries Suppliers, Purchases AND recipe costing.
    //
    // The two mistakes are not symmetrical. Clutter is noticed and ignored; a
    // missing capability is never discovered, and the shop concludes CartZe
    // cannot cost a menu.

    public function test_a_restaurant_gets_the_stock_chain(): void
    {
        $this->assertTrue(BusinessTypes::defaultFeatures('food', 'restaurant')['inventory']);
    }

    public function test_a_bakery_and_a_cloud_kitchen_get_it_too(): void
    {
        // Both live on food cost: a bakery buys flour, sugar and ghee in bulk,
        // and a cloud kitchen's whole business model is the margin.
        $this->assertTrue(BusinessTypes::defaultFeatures('food', 'bakery')['inventory']);
        $this->assertTrue(BusinessTypes::defaultFeatures('food', 'cloud_kitchen')['inventory']);
    }

    public function test_a_juice_corner_and_a_home_kitchen_do_not(): void
    {
        // Handing either of them Suppliers, Purchases and Stocktake is three
        // sidebar entries they will never open.
        $this->assertFalse(BusinessTypes::defaultFeatures('food', 'juice_corner')['inventory']);
        $this->assertFalse(BusinessTypes::defaultFeatures('food', 'home_kitchen')['inventory']);
    }

    public function test_a_food_shop_that_named_no_sub_type_is_unchanged(): void
    {
        // The old behaviour, and it must stay: an existing tenant with no
        // category recorded cannot silently gain three modules on the next
        // deploy.
        $this->assertFalse(BusinessTypes::defaultFeatures('food')['inventory']);
        $this->assertFalse(BusinessTypes::defaultFeatures('food', null)['inventory']);
    }

    public function test_a_sub_type_can_only_ever_ad_d_the_module(): void
    {
        // A mart already keeps stock. If a sub-type could take a module away,
        // the type and the sub-type would argue and the type would lose —
        // which is the wrong way round, since the type is what an admin sees.
        $this->assertTrue(BusinessTypes::defaultFeatures('mart', 'convenience_store')['inventory']);
        $this->assertTrue(BusinessTypes::defaultFeatures('mart', 'anything-at-all')['inventory']);
    }

    public function test_an_unrecognised_sub_type_changes_nothing(): void
    {
        // Typos, and categories from a future release reaching an older build.
        $this->assertFalse(BusinessTypes::defaultFeatures('food', 'not-a-real-category')['inventory']);
    }

    public function test_a_legacy_restaurant_code_is_treated_as_food(): void
    {
        // `restaurant` is an older top-level code that resolves onto `food`.
        // The map is keyed by the PRIMARY type, so the sub-type still lands.
        $this->assertTrue(BusinessTypes::defaultFeatures('restaurant', 'bakery')['inventory']);
    }
}
