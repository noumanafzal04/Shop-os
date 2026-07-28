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
}
