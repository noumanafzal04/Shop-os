<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Coupon;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class CouponTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'online_shop_enabled' => true, 'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'retail', 'features' => array_merge(BusinessTypes::defaultFeatures('retail'), ['promotions' => true, 'customers' => true]), 'delivery_fee' => 0,
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Item', 'price' => 1000, 'stock_quantity' => 100, 'track_inventory' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function coupon(array $attrs = []): Coupon
    {
        return Coupon::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->shop->id, 'code' => 'SAVE20', 'type' => 'percent', 'value' => 20, 'is_active' => true,
        ], $attrs));
    }

    // ── CRUD + validation ───────────────────────────────────────────

    public function test_create_and_duplicate_code_rejected(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/coupons', ['code' => 'eid20', 'type' => 'percent', 'value' => 20])
            ->assertCreated()->assertJsonPath('data.code', 'EID20'); // uppercased
        $this->actingAsUser($this->owner)->postJson('/api/v1/coupons', ['code' => 'EID20', 'type' => 'fixed', 'value' => 100])
            ->assertStatus(422)->assertJsonStructure(['errors' => ['code']]);
    }

    public function test_a_code_can_be_found_after_it_falls_off_the_first_page(): void
    {
        // A campaign shop passes thirty codes in a season, and a coupon is
        // found by its code and by nothing else — asked "is EID20 still live?"
        // a merchant has a string, not a date. Without a filter the older
        // codes could not be reached to expire, correct or delete them.
        // The dates are set explicitly. Thirty-five rows created inside the
        // same second all carry the same `created_at`, so "newest first" put
        // them in whatever order the database felt like — the test passed
        // alone and failed in the full suite, which is the worst kind. The
        // point here is a code that is genuinely OLDER, not one that happened
        // to sort late.
        foreach (range(1, 34) as $i) {
            $this->coupon(['code' => 'BULK'.$i, 'created_at' => now()]);
        }
        $this->coupon(['code' => 'EID20', 'created_at' => now()->subMonth()]);

        $first = $this->actingAsUser($this->owner)->getJson('/api/v1/coupons')->assertOk();
        $this->assertSame(35, $first->json('meta.pagination.total'));
        $this->assertNotContains('EID20', array_column($first->json('data'), 'code'),
            'The point of this test is a code that is NOT on page one.');

        $found = $this->actingAsUser($this->owner)->getJson('/api/v1/coupons?search=EID')->assertOk();

        $this->assertSame(['EID20'], array_column($found->json('data'), 'code'));
    }

    public function test_the_rest_can_be_walked_to(): void
    {
        foreach (range(1, 34) as $i) {
            $this->coupon(['code' => 'BULK'.$i, 'created_at' => now()->subMinutes($i)]);
        }

        $page2 = $this->actingAsUser($this->owner)->getJson('/api/v1/coupons?page=2')->assertOk();

        $this->assertSame(2, $page2->json('meta.pagination.current_page'));
        $this->assertCount(4, $page2->json('data'));
    }

    // ── validate preview ────────────────────────────────────────────

    public function test_validate_returns_discount(): void
    {
        $this->coupon(['code' => 'SAVE20', 'type' => 'percent', 'value' => 20]);
        $this->actingAsUser($this->owner)->postJson('/api/v1/coupons/validate', ['code' => 'save20', 'subtotal' => 1000])
            ->assertOk()->assertJsonPath('data.discount', 200);
    }

    public function test_validate_percent_cap(): void
    {
        $this->coupon(['code' => 'HALF', 'type' => 'percent', 'value' => 50, 'max_discount' => 300]);
        $this->actingAsUser($this->owner)->postJson('/api/v1/coupons/validate', ['code' => 'HALF', 'subtotal' => 1000])
            ->assertOk()->assertJsonPath('data.discount', 300); // 50% = 500, capped at 300
    }

    public function test_validate_min_spend_and_expiry_and_invalid(): void
    {
        $this->coupon(['code' => 'BIG', 'min_spend' => 5000]);
        $this->actingAsUser($this->owner)->postJson('/api/v1/coupons/validate', ['code' => 'BIG', 'subtotal' => 1000])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'COUPON_MIN_SPEND');

        $this->coupon(['code' => 'OLD', 'expires_at' => now()->subDay()]);
        $this->actingAsUser($this->owner)->postJson('/api/v1/coupons/validate', ['code' => 'OLD', 'subtotal' => 1000])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'COUPON_EXPIRED');

        $this->actingAsUser($this->owner)->postJson('/api/v1/coupons/validate', ['code' => 'NOPE', 'subtotal' => 1000])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'COUPON_INVALID');
    }

    // ── Apply on sale ───────────────────────────────────────────────

    public function test_coupon_applied_on_sale_and_usage_incremented(): void
    {
        $this->coupon(['code' => 'SAVE20', 'value' => 20]);

        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'coupon_code' => 'save20',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]], 'amount_paid' => 800,
        ])->assertCreated()->json('data');

        $this->assertEquals(200, $sale['discount']); // 20% of 1000
        $this->assertEquals(800, $sale['total']);
        $this->assertSame('SAVE20', $sale['coupon_code']);
        $this->assertSame(1, Coupon::withoutTenancy()->where('code', 'SAVE20')->first()->used_count);
    }

    public function test_usage_limit_enforced_at_sale(): void
    {
        $this->coupon(['code' => 'ONCE', 'type' => 'fixed', 'value' => 100, 'usage_limit' => 1]);

        $sell = fn () => $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'coupon_code' => 'ONCE',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]], 'amount_paid' => 900,
        ]);
        $sell()->assertCreated();
        $sell()->assertStatus(422)->assertJsonPath('meta.error_code', 'COUPON_EXHAUSTED');
    }

    public function test_coupon_applied_on_online_order(): void
    {
        $this->coupon(['code' => 'SAVE20', 'value' => 20]);
        $buyer = User::factory()->create(['phone' => '+9230011']);
        $order = $this->actingAsUser($buyer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'pickup', 'coupon_code' => 'SAVE20',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertEquals(200, $order['discount']);
        $this->assertEquals(800, $order['total']);
    }

    public function test_permission_and_isolation(): void
    {
        $staff = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create();
        $this->actingAsUser($staff)->getJson('/api/v1/coupons')->assertStatus(403);

        $this->coupon();
        // The other shop needs the offers module, or this passes on a 403
        // rather than on the list being empty — a locked door is not isolation.
        $other = User::factory()->shopOwner(
            Tenant::factory()->create(['features' => ['promotions' => true]]),
        )->create();
        $this->assertSame(0, $this->actingAsUser($other)->getJson('/api/v1/coupons')->json('meta.pagination.total'));
    }
}
