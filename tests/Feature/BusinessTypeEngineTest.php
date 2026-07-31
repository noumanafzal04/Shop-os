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
}
