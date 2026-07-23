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

/**
 * Pharmacy pack-breaking: one medicine counted in base units (tablets) but
 * sold as loose tablets, strips, or boxes — one shared stock pool.
 */
class PackBreakingTest extends TestCase
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
            'business_type' => 'pharmacy', 'features' => BusinessTypes::defaultFeatures('pharmacy'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** Panadol: base = tablet @ Rs 10, 1000 in stock; Strip=10, Box=100 (Rs 900). */
    private function panadol(): Product
    {
        $p = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'medicine',
            'name' => 'Panadol', 'unit' => 'tablet', 'price' => 10,
            'cost' => 6, 'stock_quantity' => 1000, 'track_inventory' => true,
        ]);
        $p->units()->create(['tenant_id' => $this->tenant->id, 'name' => 'Strip', 'factor' => 10, 'sort_order' => 0]);
        $p->units()->create(['tenant_id' => $this->tenant->id, 'name' => 'Box', 'factor' => 100, 'price' => 900, 'barcode' => 'BOX-PAN', 'sort_order' => 1]);

        return $p;
    }

    public function test_selling_a_strip_draws_base_units_and_prices_by_factor(): void
    {
        $p = $this->panadol();
        $strip = $p->units->firstWhere('name', 'Strip');

        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 200,
            'items' => [['product_id' => $p->id, 'product_unit_id' => $strip->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        // No explicit strip price → base 10 × factor 10 = 100.
        $this->assertSame('100.00', $sale['items'][0]['unit_price']);
        $this->assertSame('Strip', $sale['items'][0]['unit_name']);
        $this->assertSame('100.00', $sale['total']);
        // Stock drawn in base units: 1000 − (1 × 10) = 990.
        $this->assertEquals(990, $p->fresh()->stock_quantity);
    }

    public function test_selling_a_box_uses_its_explicit_price(): void
    {
        $p = $this->panadol();
        $box = $p->units->firstWhere('name', 'Box');

        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1000,
            'items' => [['product_id' => $p->id, 'product_unit_id' => $box->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertSame('900.00', $sale['items'][0]['unit_price']); // explicit box price
        $this->assertEquals(900, $p->fresh()->stock_quantity);       // 1000 − 100
    }

    public function test_selling_loose_tablets_uses_the_base_unit(): void
    {
        $p = $this->panadol();

        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 100,
            'items' => [['product_id' => $p->id, 'quantity' => 3]], // no unit = base tablet
        ])->assertCreated()->json('data');

        $this->assertSame('10.00', $sale['items'][0]['unit_price']);
        $this->assertSame('30.00', $sale['total']);
        $this->assertEquals(997, $p->fresh()->stock_quantity); // 1000 − 3
    }

    public function test_pack_barcode_lookup_preselects_the_pack(): void
    {
        $p = $this->panadol();
        $this->actingAsUser($this->owner)->getJson('/api/v1/pos/lookup?code=BOX-PAN')
            ->assertOk()
            ->assertJsonPath('data.product.id', $p->id)
            ->assertJsonPath('data.product_unit_id', $p->units->firstWhere('name', 'Box')->id);
    }

    public function test_pack_from_another_product_is_rejected(): void
    {
        $p = $this->panadol();
        $other = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'medicine',
            'name' => 'Brufen', 'price' => 5, 'stock_quantity' => 100, 'track_inventory' => true,
        ]);
        $otherStrip = $other->units()->create(['tenant_id' => $this->tenant->id, 'name' => 'Strip', 'factor' => 10]);

        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 200,
            'items' => [['product_id' => $p->id, 'product_unit_id' => $otherStrip->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'UNIT_UNAVAILABLE');
    }

    public function test_returning_a_strip_restocks_base_units(): void
    {
        $p = $this->panadol();
        $strip = $p->units->firstWhere('name', 'Strip');

        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 200,
            'items' => [['product_id' => $p->id, 'product_unit_id' => $strip->id, 'quantity' => 2]],
        ])->assertCreated()->json('data');
        $this->assertEquals(980, $p->fresh()->stock_quantity); // 1000 − 20

        // Return 1 of the 2 strips → +10 base back.
        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertCreated();

        $this->assertEquals(990, $p->fresh()->stock_quantity); // 980 + 10
    }

    public function test_pack_with_factor_one_is_rejected_on_create(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'medicine', 'name' => 'Bad', 'price' => 10,
            'units' => [['name' => 'Same', 'factor' => 1]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'UNIT_FACTOR_INVALID');
    }

    public function test_units_persist_and_load_on_the_product(): void
    {
        $created = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'medicine', 'name' => 'Augmentin', 'price' => 50, 'unit' => 'tablet',
            'units' => [['name' => 'Strip', 'factor' => 6, 'price' => 320]],
        ])->assertCreated()->json('data');

        $this->assertCount(1, $created['units']);
        $this->assertSame('Strip', $created['units'][0]['name']);
        $this->assertSame('6.000', $created['units'][0]['factor']);
    }
}
