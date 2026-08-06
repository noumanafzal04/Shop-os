<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * The counter's own shortlist.
 *
 * A scanner covers everything with a barcode. What it cannot do is the loose
 * half of a shop — vegetables, rice by the kilo, chai, the samosas by the till
 * — and in a mart or a dhaba those are the fastest-moving lines there are.
 * Reaching them meant typing a name into search, per item, all day.
 *
 * Two decisions are worth pinning here:
 *
 *   IT IS DERIVED, NOT CURATED. A favourites list somebody has to maintain is
 *   wrong within a month; the till already knows what it sells. A shop's first
 *   day returns nothing and the strip is simply not drawn — no setup screen, no
 *   empty state to explain.
 *
 *   UN-SCANNABLE ITEMS COME FIRST. A barcode-less item is the entire reason the
 *   strip exists, so it outranks a best-seller that a cashier can already scan
 *   in half a second.
 */
class QuickKeysTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function product(string $name, ?string $barcode, float $price = 100): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => $name, 'barcode' => $barcode, 'price' => $price,
            'stock_quantity' => 500, 'track_inventory' => true,
        ]);
    }

    /** @param  array<int, array{0: Product, 1: float}>  $lines */
    private function sell(array $lines): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 100000,
            'items' => array_map(fn ($l) => ['product_id' => $l[0]->id, 'quantity' => $l[1]], $lines),
        ])->assertCreated();
    }

    private function keys(): array
    {
        return $this->actingAsUser($this->owner)
            ->getJson('/api/v1/pos/quick-keys')->assertOk()->json('data');
    }

    public function test_a_shop_that_has_sold_nothing_gets_an_empty_strip(): void
    {
        $this->product('Cola', '8964000000001');

        $this->assertSame([], $this->keys());
    }

    public function test_what_sells_most_appears(): void
    {
        $cola = $this->product('Cola', '8964000000001');
        $chips = $this->product('Chips', '8964000000002');
        $soap = $this->product('Soap', '8964000000003');

        $this->sell([[$cola, 30]]);
        $this->sell([[$chips, 10]]);
        // Soap never sells, so it never earns a slot.

        $names = array_column($this->keys(), 'name');

        $this->assertSame(['Cola', 'Chips'], $names);
        $this->assertNotContains('Soap', $names);
    }

    /**
     * The whole point. Tomatoes sell less than cola but cannot be scanned, so
     * they are what a quick key actually saves.
     */
    public function test_an_item_with_no_barcode_outranks_a_bigger_seller_that_has_one(): void
    {
        $cola = $this->product('Cola', '8964000000001');
        $tomatoes = $this->product('Tomatoes', null);

        $this->sell([[$cola, 50]]);
        $this->sell([[$tomatoes, 5]]);

        $this->assertSame(['Tomatoes', 'Cola'], array_column($this->keys(), 'name'));
    }

    public function test_a_discontinued_best_seller_does_not_eat_a_slot(): void
    {
        $old = $this->product('Old brand', '8964000000009');
        $current = $this->product('Current brand', '8964000000010');

        $this->sell([[$old, 100]]);
        $this->sell([[$current, 1]]);

        $old->forceFill(['is_active' => false])->save();

        $this->assertSame(['Current brand'], array_column($this->keys(), 'name'));
    }

    public function test_the_strip_is_capped_and_the_cap_is_bounded(): void
    {
        for ($i = 1; $i <= 15; $i++) {
            $this->sell([[$this->product("Item {$i}", "89640000001{$i}"), 16 - $i]]);
        }

        $this->assertCount(12, $this->keys(), 'twelve slots by default');

        $asked = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/pos/quick-keys?limit=4')->assertOk()->json('data');
        $this->assertCount(4, $asked);

        // A caller asking for a thousand gets the ceiling, not a thousand.
        $huge = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/pos/quick-keys?limit=999')->assertOk()->json('data');
        $this->assertLessThanOrEqual(24, count($huge));
    }

    /** Older trade drops off — the strip reflects what sells NOW. */
    public function test_only_the_recent_window_counts(): void
    {
        $stale = $this->product('Last season', '8964000000021');
        $this->sell([[$stale, 99]]);

        Sale::withoutTenancy()->update(['sold_at' => now()->subDays(60)]);

        $this->assertSame([], $this->keys(), 'a 30-day window has forgotten it');
        $this->assertNotEmpty(
            $this->actingAsUser($this->owner)->getJson('/api/v1/pos/quick-keys?days=90')->json('data'),
            'and a 90-day window still remembers',
        );
    }

    public function test_the_strip_rides_the_pos_module(): void
    {
        $this->tenant->forceFill([
            'features' => array_merge(BusinessTypes::defaultFeatures('mart'), ['pos' => false]),
        ])->save();

        $this->actingAsUser($this->owner)->getJson('/api/v1/pos/quick-keys')
            ->assertForbidden()
            ->assertJsonPath('meta.error_code', 'MODULE_DISABLED');
    }
}
