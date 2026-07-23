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
 * Exchange = return old items + buy replacements in one atomic step. The
 * returned value is credited to the new sale; the customer settles only the
 * difference. Stock moves both ways through the audited inventory path.
 */
class ExchangeTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'retail', 'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function product(string $name, float $price, float $stock): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => $name, 'price' => $price, 'cost' => $price / 2, 'stock_quantity' => $stock, 'track_inventory' => true,
        ]);
    }

    private function sell(Product $p): array
    {
        return $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 100000,
            'items' => [['product_id' => $p->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');
    }

    public function test_upgrade_exchange_charges_only_the_difference(): void
    {
        $shirtS = $this->product('Shirt S', 100, 5);
        $shirtL = $this->product('Shirt L', 150, 5);

        $sale = $this->sell($shirtS);
        $this->assertEquals(4, $shirtS->fresh()->stock_quantity); // 1 sold

        $res = $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/exchange", [
            'return_items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
            'items' => [['product_id' => $shirtL->id, 'quantity' => 1]], // 150
            'payments' => [['method' => 'cash', 'amount' => 50]],        // the 50 difference
        ])->assertCreated()->json('data');

        $this->assertEquals(50, $res['difference']);
        $this->assertEquals(150, $res['sale']['total']);
        $this->assertSame('split', $res['sale']['payment_method']); // credit + cash
        $this->assertEquals(5, $shirtS->fresh()->stock_quantity); // returned → restocked
        $this->assertEquals(4, $shirtL->fresh()->stock_quantity); // replacement sold
    }

    public function test_even_exchange_moves_no_money(): void
    {
        $red = $this->product('Mug Red', 100, 5);
        $blue = $this->product('Mug Blue', 100, 5);

        $sale = $this->sell($red);

        $res = $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/exchange", [
            'return_items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
            'items' => [['product_id' => $blue->id, 'quantity' => 1]], // 100 = credit
        ])->assertCreated()->json('data');

        $this->assertEquals(0, $res['difference']);
        $this->assertEquals(100, $res['sale']['total']);
        $this->assertEquals(5, $red->fresh()->stock_quantity);
        $this->assertEquals(4, $blue->fresh()->stock_quantity);
    }

    public function test_underpaid_difference_rolls_back_the_whole_exchange(): void
    {
        $cheap = $this->product('Cheap', 100, 5);
        $pricey = $this->product('Pricey', 150, 5);

        $sale = $this->sell($cheap);

        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/exchange", [
            'return_items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
            'items' => [['product_id' => $pricey->id, 'quantity' => 1]], // 150, credit 100
            'payments' => [['method' => 'cash', 'amount' => 20]],        // only 20 of the 50 due
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'PAYMENT_INSUFFICIENT');

        // Nothing applied: the return was rolled back with the failed sale.
        $this->assertEquals(4, $cheap->fresh()->stock_quantity); // still sold, not restocked
        $this->assertEquals(5, $pricey->fresh()->stock_quantity); // never sold
    }
}
