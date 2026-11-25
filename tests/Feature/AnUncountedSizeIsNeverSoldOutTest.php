<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A SIZE OF A DISH WHOSE STOCK IS NOT COUNTED IS NEVER "OUT".
 *
 * Found by the end-to-end run (ORD-000003): Chicken Karahi Half/Full have
 * stock counting off, so `stock_quantity` is 0 — and the marketplace read
 * each size's `in_stock` from the count alone. Every size said unavailable,
 * the app greyed out the whole dish, and the server sold it anyway.
 */
class AnUncountedSizeIsNeverSoldOutTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'online_shop_enabled' => true, 'city_id' => $city->id,
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function dish(bool $counted, int $stock): void
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->postJson('/api/v1/products', [
            'name' => 'Chicken Karahi', 'item_type' => 'physical_product', 'price' => 1100,
            'track_inventory' => $counted, 'visible_in_marketplace' => true,
            'variants' => [
                ['name' => 'Half', 'price' => 1100, 'stock_quantity' => $stock],
                ['name' => 'Full', 'price' => 2000, 'stock_quantity' => $stock],
            ],
        ])->assertCreated();
        $this->app['auth']->forgetGuards();
    }

    private function sizes(): array
    {
        $items = $this->withoutToken()->getJson("/api/v1/marketplace/shops/{$this->shop->slug}/products")->assertOk()->json('data');

        return collect(collect($items)->firstWhere('name', 'Chicken Karahi')['variants'])->pluck('in_stock', 'name')->all();
    }

    public function test_an_uncounted_dish_offers_every_size(): void
    {
        $this->dish(counted: false, stock: 0);

        $this->assertSame(['Half' => true, 'Full' => true], $this->sizes());
    }

    public function test_a_counted_size_at_nothing_is_still_out(): void
    {
        // The denominator: the fix must not mark everything available.
        $this->dish(counted: true, stock: 0);

        $this->assertSame(['Half' => false, 'Full' => false], $this->sizes());
    }
}
