<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * EVERY CARD GETS ITS OWN STRIP — however busy the shop beside it is.
 *
 * A home card shows five of the shop's own items. They were read as ONE pool
 * for the whole page (newest first, `shops × 15` rows), so a shop that had just
 * loaded sixty items took every row and its neighbours' strips came back
 * empty. And the "All shops" list that scrolls on below the first twelve
 * cards draws those same cards page after page, so it asks for the strips too.
 */
class EveryCardGetsItsOwnStripTest extends TestCase
{
    use RefreshDatabase;

    private const HERE = ['lat' => 31.5204, 'lng' => 74.3587];

    private City $city;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        Cache::flush();
        $this->city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
    }

    private function shop(string $name, float $dLat, int $items, int $daysOld): Tenant
    {
        $features = BusinessTypes::defaultFeatures('food');
        $features['marketplace'] = true;
        $shop = Tenant::factory()->create([
            'business_name' => $name, 'online_shop_enabled' => true, 'setup_completed' => true,
            'business_type' => 'food', 'features' => $features, 'city_id' => $this->city->id,
            'latitude' => self::HERE['lat'] + $dLat, 'longitude' => self::HERE['lng'],
        ]);
        for ($i = 1; $i <= $items; $i++) {
            $p = Product::withoutTenancy()->create([
                'tenant_id' => $shop->id, 'type' => 'product', 'item_type' => 'food_item', 'name' => "{$name} dish {$i}",
                'price' => 100 + $i, 'track_inventory' => false, 'visible_in_marketplace' => true, 'is_active' => true,
            ]);
            $p->forceFill(['created_at' => now()->subDays($daysOld)->addMinutes($i)])->saveQuietly();
        }

        return $shop;
    }

    /** @return array<string, int> business name => how many items its card shows */
    private function strips(array $cards): array
    {
        return collect($cards)->mapWithKeys(fn (array $c) => [$c['business_name'] => count($c['preview_products'])])->all();
    }

    public function test_a_shop_with_sixty_new_items_does_not_blank_its_neighbours(): void
    {
        $this->shop('Busy Kitchen', 0.001, 60, 0);   // everything it has is newer than the others'
        $this->shop('Quiet Bakery', 0.002, 3, 30);
        $this->shop('Corner Tikka', 0.003, 7, 30);

        $home = $this->getJson('/api/v1/marketplace/home?'.http_build_query(self::HERE))->assertOk()->json('data.nearby');

        $this->assertSame(['Busy Kitchen' => 5, 'Quiet Bakery' => 3, 'Corner Tikka' => 5], $this->strips($home));
        $tikka = collect($home)->firstWhere('business_name', 'Corner Tikka');
        $this->assertSame(['Corner Tikka dish 7', 'Corner Tikka dish 6', 'Corner Tikka dish 5', 'Corner Tikka dish 4', 'Corner Tikka dish 3'],
            collect($tikka['preview_products'])->pluck('name')->all(), 'its own newest five, newest first');
    }

    public function test_the_scrolling_list_carries_the_strip_on_every_page_when_asked_and_only_then(): void
    {
        $this->shop('Busy Kitchen', 0.001, 60, 0);
        $this->shop('Quiet Bakery', 0.002, 3, 30);
        $this->shop('Corner Tikka', 0.003, 7, 30);

        $ask = fn (int $page, bool $previews) => $this->getJson('/api/v1/marketplace/shops?'.http_build_query(
            self::HERE + ['per_page' => 2, 'page' => $page] + ($previews ? ['previews' => 1] : []),
        ))->assertOk();

        $first = $ask(1, true);
        $this->assertSame(['Busy Kitchen' => 5, 'Quiet Bakery' => 3], $this->strips($first->json('data')), 'nearest first');
        $this->assertSame(2, $first->json('meta.pagination.last_page'));
        $this->assertSame(['Corner Tikka' => 5], $this->strips($ask(2, true)->json('data')), 'page two keeps the cards whole');

        $this->assertArrayNotHasKey('preview_products', $ask(1, false)->json('data.0'), 'search and trade lists do not pay for a strip they hide');
    }
}
