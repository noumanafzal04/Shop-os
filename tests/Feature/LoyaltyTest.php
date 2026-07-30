<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Customer;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Loyalty & rewards: earn points on completed sales, redeem them as a counter
 * discount, and reverse both symmetrically on returns/cancels — mirrors the
 * khata (credit) ledger.
 */
class LoyaltyTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Product $product;

    private string $phone = '03001112222';

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
            'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Rice 5kg', 'price' => 100, 'stock_quantity' => 1000, 'track_inventory' => true,
        ]);
        $this->setLoyalty();
    }

    private function setLoyalty(array $over = []): void
    {
        $this->tenant->forceFill(['settings' => array_merge([
            'loyalty_enabled' => true,
            'loyalty_earn_per_amount' => 100,   // 1 pt per Rs 100
            'loyalty_redeem_value' => 1,        // 1 pt = Rs 1
            'loyalty_min_redeem' => 0,
        ], $over)])->save();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function customerWithPoints(int $points): Customer
    {
        return Customer::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'phone' => $this->phone, 'name' => 'Ali',
            'loyalty_points' => $points,
        ]);
    }

    private function points(): int
    {
        return (int) Customer::withoutTenancy()->where('phone', $this->phone)->first()->loyalty_points;
    }

    private function sell(float $qty, array $extra = []): TestResponse
    {
        return $this->actingAsUser($this->owner)->postJson('/api/v1/sales', array_merge([
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 100000,
            'customer_name' => 'Ali', 'customer_phone' => $this->phone,
            'items' => [['product_id' => $this->product->id, 'quantity' => $qty]],
        ], $extra));
    }

    public function test_a_sale_earns_points(): void
    {
        $sale = $this->sell(5)->assertCreated()->json('data'); // Rs 500

        $this->assertSame(5, (int) $sale['points_earned']);
        $this->assertSame(5, $this->points());
    }

    public function test_no_points_without_a_customer(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 100000,
            'items' => [['product_id' => $this->product->id, 'quantity' => 5]],
        ])->assertCreated()->assertJsonPath('data.points_earned', 0);
    }

    public function test_redeeming_points_discounts_the_bill_and_the_balance(): void
    {
        $this->setLoyalty(['loyalty_earn_per_amount' => 1000000]); // isolate: no earn on this sale
        $this->customerWithPoints(100);

        $sale = $this->sell(2, ['redeem_points' => 50])->assertCreated()->json('data'); // Rs 200 − Rs 50

        $this->assertSame(50.0, (float) $sale['discount']);
        $this->assertSame(150.0, (float) $sale['total']);
        $this->assertSame(50, (int) $sale['points_redeemed']);
        $this->assertSame(50, $this->points()); // 100 − 50
    }

    public function test_earn_excludes_redeemed_value(): void
    {
        $this->customerWithPoints(100);

        // Rs 500 − Rs 100 redeemed = Rs 400 net → earns 4 (not 5).
        $sale = $this->sell(5, ['redeem_points' => 100])->assertCreated()->json('data');

        $this->assertSame(4, (int) $sale['points_earned']);
        $this->assertSame(4, $this->points()); // 100 − 100 redeemed + 4 earned
    }

    public function test_cannot_redeem_more_than_balance(): void
    {
        $this->customerWithPoints(10);

        $this->sell(2, ['redeem_points' => 50])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'INSUFFICIENT_POINTS');
    }

    public function test_redeeming_below_minimum_is_rejected(): void
    {
        $this->setLoyalty(['loyalty_min_redeem' => 100]);
        $this->customerWithPoints(200);

        $this->sell(2, ['redeem_points' => 50])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'POINTS_BELOW_MIN');
    }

    public function test_points_cannot_exceed_the_bill(): void
    {
        $this->customerWithPoints(10000);

        // Rs 100 bill, trying to redeem Rs 10000 of points.
        $this->sell(1, ['redeem_points' => 10000])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'POINTS_EXCEED_BILL');
    }

    public function test_cancel_reverses_earned_points(): void
    {
        $sale = $this->sell(5)->assertCreated()->json('data'); // earn 5
        $this->assertSame(5, $this->points());

        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/cancel")->assertOk();

        $this->assertSame(0, $this->points());
    }

    public function test_return_claws_back_earned_points_proportionally(): void
    {
        $sale = $this->sell(5)->assertCreated()->json('data'); // Rs 500 → earn 5
        $this->assertSame(5, $this->points());

        // Return 2 of 5 units (Rs 200 of Rs 500 = 40%) → claw back round(5×0.4)=2.
        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 2]],
        ])->assertCreated();

        $this->assertSame(3, $this->points());
    }

    public function test_cancel_refunds_redeemed_points(): void
    {
        $this->setLoyalty(['loyalty_earn_per_amount' => 1000000]); // isolate redeem
        $this->customerWithPoints(100);

        $sale = $this->sell(2, ['redeem_points' => 50])->assertCreated()->json('data');
        $this->assertSame(50, $this->points()); // spent 50

        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/cancel")->assertOk();

        $this->assertSame(100, $this->points()); // got the 50 back
    }
}
