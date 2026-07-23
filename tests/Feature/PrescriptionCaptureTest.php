<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class PrescriptionCaptureTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Product $medicine;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'pharmacy', 'features' => BusinessTypes::defaultFeatures('pharmacy'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->medicine = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'medicine',
            'name' => 'Augmentin 625mg', 'sku' => 'AUG-625', 'price' => 500, 'cost' => 300,
            'stock_quantity' => 40, 'track_inventory' => true, 'requires_prescription' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    public function test_prescription_is_recorded_on_the_sale(): void
    {
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 500,
            'items' => [['product_id' => $this->medicine->id, 'quantity' => 1]],
            'prescription_number' => 'RX-9981',
            'prescriber_name' => 'Dr. Ayesha Khan',
            'patient_name' => 'Bilal Ahmed',
            'prescription_notes' => 'Twice daily for 7 days',
        ])->assertCreated()->json('data');

        $this->assertSame('RX-9981', $sale['prescription_number']);
        $this->assertSame('Dr. Ayesha Khan', $sale['prescriber_name']);
        $this->assertSame('Bilal Ahmed', $sale['patient_name']);
        $this->assertSame('Twice daily for 7 days', $sale['prescription_notes']);
    }

    public function test_prescription_is_optional_and_never_blocks_a_sale(): void
    {
        // Rx capture is a soft record — an Rx item can still sell without it
        // (some shops keep paper scripts); the fields simply stay null.
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 500,
            'items' => [['product_id' => $this->medicine->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertNull($sale['prescription_number']);
    }
}
