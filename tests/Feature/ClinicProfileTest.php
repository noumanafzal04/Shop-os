<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\ItemTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * MEDICAL clinic profile: one shop that sells BOTH medicines (stock-tracked,
 * Rx/expiry) AND services (consultations/procedures) — in the same sale.
 */
class ClinicProfileTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'clinic', 'features' => BusinessTypes::defaultFeatures('clinic'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    public function test_clinic_offers_medicine_service_and_physical_item_types(): void
    {
        $types = BusinessTypes::itemTypesFor('clinic');
        $this->assertContains(ItemTypes::MEDICINE, $types);
        $this->assertContains(ItemTypes::SERVICE, $types);
        $this->assertContains(ItemTypes::PHYSICAL, $types);
    }

    public function test_clinic_enables_products_services_and_appointments(): void
    {
        $f = BusinessTypes::defaultFeatures('clinic');
        $this->assertTrue($f['products']);
        $this->assertTrue($f['services']);
        $this->assertTrue($f['reservations']);
        $this->assertTrue($f['inventory']);
    }

    public function test_clinic_can_sell_a_medicine_and_a_consultation_in_one_sale(): void
    {
        // A stock-tracked medicine and a zero-stock service (consultation).
        $medicine = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'medicine',
            'name' => 'Amoxil 250mg', 'price' => 150, 'stock_quantity' => 40, 'track_inventory' => true,
        ]);
        $consult = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'service', 'item_type' => 'service',
            'name' => 'Doctor Consultation', 'price' => 1000, 'track_inventory' => false,
        ]);

        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1300,
            'items' => [
                ['product_id' => $consult->id, 'quantity' => 1],
                ['product_id' => $medicine->id, 'quantity' => 2],
            ],
        ])->assertCreated()->json('data');

        // 1000 + (150 × 2) = 1300.
        $this->assertSame('1300.00', $sale['total']);
        // Medicine stock drops; the service has none to touch.
        $this->assertEquals(38, $medicine->fresh()->stock_quantity);
    }
}
