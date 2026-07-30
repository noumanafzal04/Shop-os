<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\City;
use App\Models\Product;
use App\Models\Promotion;
use App\Models\Tenant;
use App\Models\User;
use App\Services\PromotionService;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Promotions: automatic scheduled discounts the server applies at checkout —
 * scoped to order / category / product, live only within their schedule.
 */
class PromotionTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Product $rice;   // no category

    private Category $drinks;

    private Product $cola;   // in drinks

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'), 'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();

        $this->drinks = Category::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Drinks', 'sort_order' => 0, 'is_active' => true,
        ]);
        $this->rice = $this->product('Rice', 100);
        $this->cola = $this->product('Cola', 100, $this->drinks->id);
    }

    private function product(string $name, float $price, ?string $categoryId = null): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => $name, 'price' => $price, 'stock_quantity' => 1000, 'track_inventory' => true,
            'category_id' => $categoryId,
        ]);
    }

    private function promo(array $over): Promotion
    {
        return Promotion::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->tenant->id, 'name' => 'Promo', 'type' => 'percent',
            'value' => 10, 'scope' => 'order', 'is_active' => true, 'priority' => 0,
        ], $over));
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @param array<int, array{0: Product, 1: float}> $items */
    private function sell(array $items): TestResponse
    {
        return $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 1000000,
            'items' => array_map(fn ($i) => ['product_id' => $i[0]->id, 'quantity' => $i[1]], $items),
        ]);
    }

    public function test_order_scope_percent_applies_and_is_stamped(): void
    {
        $p = $this->promo(['name' => 'Eid 10%', 'type' => 'percent', 'value' => 10, 'scope' => 'order']);

        $sale = $this->sell([[$this->rice, 5]])->assertCreated()->json('data'); // Rs 500

        $this->assertSame(50.0, (float) $sale['promo_discount']);
        $this->assertSame(50.0, (float) $sale['discount']);
        $this->assertSame(450.0, (float) $sale['total']);
        $this->assertSame($p->id, $sale['promotion_id']);
        $this->assertSame('Eid 10%', $sale['promo_name']);
    }

    public function test_category_scope_only_discounts_matching_items(): void
    {
        $this->promo(['name' => 'Drinks 50%', 'type' => 'percent', 'value' => 50, 'scope' => 'category', 'category_id' => $this->drinks->id]);

        // Rice 100 (no cat) + Cola 100 (drinks) → 50% off the Cola only = 50.
        $sale = $this->sell([[$this->rice, 1], [$this->cola, 1]])->assertCreated()->json('data');

        $this->assertSame(50.0, (float) $sale['promo_discount']);
        $this->assertSame(150.0, (float) $sale['total']);
    }

    public function test_product_scope_fixed_amount(): void
    {
        $this->promo(['name' => 'Rice -30', 'type' => 'fixed', 'value' => 30, 'scope' => 'product', 'product_ids' => [$this->rice->id]]);

        $sale = $this->sell([[$this->rice, 2], [$this->cola, 1]])->assertCreated()->json('data');

        $this->assertSame(30.0, (float) $sale['promo_discount']);
    }

    public function test_min_spend_gates_the_promotion(): void
    {
        $this->promo(['type' => 'percent', 'value' => 10, 'scope' => 'order', 'min_spend' => 1000]);

        $sale = $this->sell([[$this->rice, 5]])->assertCreated()->json('data'); // Rs 500 < 1000

        $this->assertSame(0.0, (float) $sale['promo_discount']);
    }

    public function test_the_best_promotion_wins(): void
    {
        $this->promo(['name' => '10%', 'value' => 10, 'scope' => 'order']);
        $this->promo(['name' => '20%', 'value' => 20, 'scope' => 'order']);

        $sale = $this->sell([[$this->rice, 5]])->assertCreated()->json('data'); // Rs 500

        $this->assertSame(100.0, (float) $sale['promo_discount']); // 20% wins
        $this->assertSame('20%', $sale['promo_name']);
    }

    public function test_a_future_dated_promotion_does_not_apply(): void
    {
        $this->promo(['value' => 10, 'scope' => 'order', 'starts_on' => now()->addWeek()->toDateString()]);

        $sale = $this->sell([[$this->rice, 5]])->assertCreated()->json('data');

        $this->assertSame(0.0, (float) $sale['promo_discount']);
    }

    public function test_preview_returns_the_best_promotion(): void
    {
        $this->promo(['name' => 'Store 15%', 'value' => 15, 'scope' => 'order']);

        $res = $this->actingAsUser($this->owner)->postJson('/api/v1/promotions/preview', [
            'items' => [['product_id' => $this->rice->id, 'quantity' => 4]], // Rs 400
        ])->assertOk()->json('data');

        $this->assertSame('Store 15%', $res['name']);
        $this->assertSame(60.0, (float) $res['discount']);
    }

    public function test_live_now_respects_day_and_time_window(): void
    {
        $service = app(PromotionService::class);
        $monday = Carbon::parse('2026-07-27 23:00:00'); // a fixed instant

        // Happy hour today, window that wraps midnight (22:00–02:00) → live at 23:00.
        $live = $this->promo(['days_of_week' => [$monday->dayOfWeek], 'start_time' => '22:00', 'end_time' => '02:00']);
        $this->assertTrue($service->liveNow($live, $monday));

        // Wrong day → not live.
        $offDay = $this->promo(['days_of_week' => [($monday->dayOfWeek + 1) % 7]]);
        $this->assertFalse($service->liveNow($offDay, $monday));

        // Outside the time window (12:00 not in 22:00–02:00) → not live.
        $this->assertFalse($service->liveNow($live, Carbon::parse('2026-07-27 12:00:00')));
    }
}
