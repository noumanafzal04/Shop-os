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

class MarketplaceTest extends TestCase
{
    use RefreshDatabase;

    private City $city;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);
        $this->city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
    }

    /**
     * A fully marketplace-eligible shop.
     */
    private function onlineShop(array $overrides = []): Tenant
    {
        return Tenant::factory()->create(array_merge([
            'online_shop_enabled' => true,
            'setup_completed' => true,
            'city_id' => $this->city->id,
            'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'),
        ], $overrides));
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('test-device', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    // ── Visibility rules ────────────────────────────────────────────

    public function test_only_eligible_shops_are_listed(): void
    {
        $visible = $this->onlineShop(['business_name' => 'Visible Mart']);

        // Every hidden case from the spec:
        Tenant::factory()->create(['business_name' => 'Expense Only', 'setup_completed' => true, 'city_id' => $this->city->id, 'features' => BusinessTypes::defaultFeatures('retail')]); // plan off
        $this->onlineShop(['business_name' => 'Suspended Shop', 'status' => 'suspended']);
        $this->onlineShop(['business_name' => 'Unfinished Shop', 'setup_completed' => false]);
        $this->onlineShop(['business_name' => 'Long Expired', 'subscription_ends_at' => now()->subDays(30)]);
        $this->onlineShop(['business_name' => 'No Marketplace Type', 'features' => BusinessTypes::defaultFeatures('service')]); // service type: marketplace false
        $deleted = $this->onlineShop(['business_name' => 'Deleted Shop']);
        $deleted->delete();

        $response = $this->getJson('/api/v1/marketplace/shops')->assertOk();

        $names = collect($response->json('data'))->pluck('business_name');
        $this->assertSame(['Visible Mart'], $names->all());

        // Direct access to a hidden shop → 404, existence never revealed.
        $this->getJson('/api/v1/marketplace/shops/'.$deleted->slug)->assertStatus(404);
    }

    /**
     * A card nobody can decide from is a card that has to be opened.
     *
     * The list used to carry a name, a rating and a distance — and nothing
     * about the two things anyone actually chooses on: how long the food takes
     * and what delivery costs. Both were detail-only, so the shop that turns
     * out to be an hour away for Rs 200 was the one you found last.
     */
    public function test_the_shop_list_carries_what_a_card_needs_to_decide(): void
    {
        $this->onlineShop([
            'business_name' => 'Cheesy Slice',
            // A fee with paisa in it on purpose: a whole number survives an
            // int cast unnoticed, so it cannot tell whether the value arrived
            // as money or as a rounded-down approximation of it.
            'delivery_fee' => 120.50,
            'settings' => ['prep_time_minutes' => 45, 'free_delivery_threshold' => 1500],
        ]);

        $card = $this->getJson('/api/v1/marketplace/shops')
            ->assertOk()
            ->json('data.0');

        $this->assertTrue($card['delivers']);
        $this->assertSame(120.5, $card['delivery_fee']);
        $this->assertSame(45, $card['prep_time_minutes']);
        // JSON has one number type, so a whole 1500.0 reaches the client as
        // 1500 — which is what the app reads, and what this asserts.
        $this->assertSame(1500, $card['free_delivery_threshold']);
    }

    /**
     * A shop that has set none of them says so, rather than saying zero.
     *
     * "Free delivery, ready in 0 minutes" is what a missing setting looks like
     * once a client renders it, and it is a promise the shop never made.
     */
    /**
     * A zero fee means two different things, and only this tells them apart.
     *
     * "Free delivery" on a shop that does not deliver is a card sending
     * somebody across town to a counter.
     */
    public function test_a_pickup_only_shop_is_not_a_free_delivery_shop(): void
    {
        $type = BusinessTypes::defaultFeatures('retail');
        $type['delivery'] = false;

        $this->onlineShop(['delivery_fee' => 0, 'features' => $type]);

        $card = $this->getJson('/api/v1/marketplace/shops')->assertOk()->json('data.0');

        $this->assertFalse($card['delivers']);
        $this->assertSame(0, $card['delivery_fee']);
    }

    public function test_an_unset_prep_time_is_null_and_not_zero(): void
    {
        $this->onlineShop(['settings' => []]);

        $card = $this->getJson('/api/v1/marketplace/shops')->assertOk()->json('data.0');

        $this->assertNull($card['prep_time_minutes']);
        $this->assertNull($card['free_delivery_threshold']);
    }

    public function test_grace_period_shop_still_listed(): void
    {
        $this->onlineShop(['business_name' => 'Grace Mart', 'subscription_ends_at' => now()->subDays(3)]);

        $names = collect($this->getJson('/api/v1/marketplace/shops')->json('data'))
            ->pluck('business_name');

        $this->assertContains('Grace Mart', $names);
    }

    public function test_city_filter_and_search(): void
    {
        $lahore = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->onlineShop(['business_name' => 'Karachi Store']);
        $this->onlineShop(['business_name' => 'Lahore Store', 'city_id' => $lahore->id]);

        $karachiOnly = collect($this->getJson("/api/v1/marketplace/shops?city_id={$this->city->id}")
            ->json('data'))->pluck('business_name');
        $this->assertSame(['Karachi Store'], $karachiOnly->all());

        $searched = collect($this->getJson('/api/v1/marketplace/shops?search=Lahore')
            ->json('data'))->pluck('business_name');
        $this->assertSame(['Lahore Store'], $searched->all());
    }

    // ── Public product catalog ──────────────────────────────────────

    public function test_shop_products_are_public_but_never_leak_internals(): void
    {
        $shop = $this->onlineShop();
        Product::withoutTenancy()->create([
            'tenant_id' => $shop->id, 'type' => 'product', 'name' => 'Public Shirt',
            'price' => 999, 'cost' => 500, 'stock_quantity' => 7, 'visible_in_marketplace' => true,
        ]);
        Product::withoutTenancy()->create([
            'tenant_id' => $shop->id, 'type' => 'product', 'name' => 'Hidden Item',
            'price' => 10, 'visible_in_marketplace' => false,
        ]);
        Product::withoutTenancy()->create([
            'tenant_id' => $shop->id, 'type' => 'product', 'name' => 'Inactive Item',
            'price' => 10, 'is_active' => false,
        ]);

        $response = $this->getJson("/api/v1/marketplace/shops/{$shop->slug}/products")->assertOk();
        $items = $response->json('data');

        $this->assertCount(1, $items);
        $this->assertSame('Public Shirt', $items[0]['name']);
        $this->assertTrue($items[0]['in_stock']);

        // The exact numbers a competitor could abuse are absent.
        $this->assertArrayNotHasKey('cost', $items[0]);
        $this->assertArrayNotHasKey('stock_quantity', $items[0]);
        $this->assertStringNotContainsString('"cost"', $response->getContent());
    }

    public function test_out_of_stock_shows_as_unavailable_not_hidden(): void
    {
        $shop = $this->onlineShop();
        Product::withoutTenancy()->create([
            'tenant_id' => $shop->id, 'type' => 'product', 'name' => 'Sold Out',
            'price' => 100, 'stock_quantity' => 0,
        ]);

        $items = $this->getJson("/api/v1/marketplace/shops/{$shop->slug}/products")->json('data');

        $this->assertSame('Sold Out', $items[0]['name']);
        $this->assertFalse($items[0]['in_stock']);
    }

    // ── Customer registration ───────────────────────────────────────

    public function test_customer_registration_returns_tokens(): void
    {
        $response = $this->postJson('/api/v1/auth/register', [
            'name' => 'Sara Customer',
            'email' => 'sara@test.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.user.role', 'customer')
            ->assertJsonStructure(['data' => ['access_token', 'refresh_token']]);
    }

    public function test_duplicate_customer_email_and_phone_rejected(): void
    {
        User::factory()->create(['email' => 'sara@test.com', 'phone' => '+923001112223']);

        $this->postJson('/api/v1/auth/register', [
            'name' => 'X', 'email' => 'sara@test.com',
            'password' => 'password123', 'password_confirmation' => 'password123',
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['email']]);

        $this->postJson('/api/v1/auth/register', [
            'name' => 'X', 'phone' => '+923001112223',
            'password' => 'password123', 'password_confirmation' => 'password123',
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['phone']]);
    }

    public function test_registration_cannot_create_privileged_roles(): void
    {
        $response = $this->postJson('/api/v1/auth/register', [
            'name' => 'Sneaky',
            'email' => 'sneak@test.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
            'role' => 'super_admin', // ignored
            'tenant_id' => 'anything', // ignored
        ]);

        $response->assertCreated()->assertJsonPath('data.user.role', 'customer');
        $this->assertNull(User::query()->where('email', 'sneak@test.com')->first()->tenant_id);
    }

    // ── Favorites ───────────────────────────────────────────────────

    public function test_customer_can_toggle_and_list_favorites(): void
    {
        $shop = $this->onlineShop(['business_name' => 'Fav Mart']);
        $customer = User::factory()->create(); // role customer

        $this->actingAsUser($customer)->postJson("/api/v1/customer/favorites/{$shop->slug}")
            ->assertOk()->assertJsonPath('data.favorited', true);

        $favorites = $this->actingAsUser($customer)->getJson('/api/v1/customer/favorites')
            ->assertOk()->json('data');
        $this->assertSame('Fav Mart', $favorites[0]['business_name']);

        // Toggle off.
        $this->actingAsUser($customer)->postJson("/api/v1/customer/favorites/{$shop->slug}")
            ->assertOk()->assertJsonPath('data.favorited', false);
        $this->assertCount(0, $this->actingAsUser($customer)
            ->getJson('/api/v1/customer/favorites')->json('data'));
    }

    public function test_shop_owner_cannot_use_customer_endpoints(): void
    {
        $owner = User::factory()->shopOwner()->create();

        $this->actingAsUser($owner)->getJson('/api/v1/customer/favorites')
            ->assertStatus(403);
    }

    public function test_a_trade_filter_finds_shops_stored_under_the_old_name_for_it(): void
    {
        /**
         * "Grocery tab — ALL shops not showing."
         *
         * The tab passes `business_type=grocery`, and `grocery` is the LEGACY
         * name for `mart`: every shop created since the primary types replaced
         * the narrow codes is stored as `mart`. The filter was
         * `where('business_type', $type)` — exact — so the tab asked for a
         * code almost nothing has and came back empty on an app full of
         * grocery shops.
         *
         * The same trap sits under food/restaurant, and under the four codes
         * that became retail.
         */
        // The family itself, exactly. Asserting only that the FILTER returns
        // both shops passed on a `codesFor` that returned every legacy code
        // there is — over-broad, and invisible because the one wrong shop in
        // the fixture happened not to be in that list.
        $this->assertSame(['grocery', 'mart'], BusinessTypes::codesFor('grocery'));
        $this->assertSame(['mart', 'grocery'], BusinessTypes::codesFor('mart'));
        $this->assertSame(['food', 'restaurant'], BusinessTypes::codesFor('food'));
        $this->assertSame(['pharmacy', 'clinic'], BusinessTypes::codesFor('pharmacy'));
        // A trade with no old name is just itself.
        $this->assertSame(['petroleum'], BusinessTypes::codesFor('petroleum'));

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);

        $modern = Tenant::factory()->create([
            'business_name' => 'New Mart', 'online_shop_enabled' => true, 'setup_completed' => true,
            'city_id' => $city->id, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $old = Tenant::factory()->create([
            'business_name' => 'Old Grocery', 'online_shop_enabled' => true, 'setup_completed' => true,
            'city_id' => $city->id, 'business_type' => 'grocery',
            'features' => BusinessTypes::defaultFeatures('grocery'),
        ]);
        $other = Tenant::factory()->create([
            'business_name' => 'A Pharmacy', 'online_shop_enabled' => true, 'setup_completed' => true,
            'city_id' => $city->id, 'business_type' => 'pharmacy',
            'features' => BusinessTypes::defaultFeatures('pharmacy'),
        ]);

        foreach (['grocery', 'mart'] as $asked) {
            $names = collect(
                $this->getJson("/api/v1/marketplace/shops?business_type={$asked}")
                    ->assertOk()
                    ->json('data')
            )->pluck('business_name');

            // Both names, whichever one was asked for.
            $this->assertTrue($names->contains($modern->business_name), "asked {$asked}, lost the mart");
            $this->assertTrue($names->contains($old->business_name), "asked {$asked}, lost the grocery");
            // …and the filter still FILTERS. Without this the test would pass
            // on a query that had stopped narrowing anything at all.
            $this->assertFalse($names->contains($other->business_name), "asked {$asked}, kept a pharmacy");
        }
    }

    public function test_a_shop_on_the_home_screen_carries_a_few_of_its_own_items(): void
    {
        // A row of shop names is a directory. A card showing three of the
        // things the shop actually sells is a reason to tap it — and it is how
        // somebody chooses between two burger places without opening either.
        $shop = Tenant::factory()->create([
            'online_shop_enabled' => true, 'setup_completed' => true,
            'business_type' => 'grocery', 'features' => BusinessTypes::defaultFeatures('grocery'),
        ]);

        foreach ([['Rice', 900, null], ['Sugar', 300, 240], ['Tea', 700, null], ['Oil', 1200, 999], ['Salt', 80, null], ['Flour', 500, null]] as [$name, $price, $cut]) {
            Product::withoutTenancy()->create([
                'tenant_id' => $shop->id, 'type' => 'product', 'item_type' => 'physical_product',
                'name' => $name, 'price' => $price, 'discount_price' => $cut,
                'is_active' => true, 'visible_in_marketplace' => true,
            ]);
        }

        $nearby = $this->getJson('/api/v1/marketplace/home')
            ->assertOk()
            ->json('data.nearby');

        $card = collect($nearby)->firstWhere('slug', $shop->slug);
        $this->assertNotNull($card);

        // FIVE, not six, and the CEILING is the point rather than the number.
        // The strip scrolls sideways, so a sixth costs nothing in height —
        // which is exactly why it needs a limit written down, or this quietly
        // becomes "everything the shop sells" on the most requested endpoint
        // in the product. A card is a glance, not a catalogue.
        $this->assertCount(5, $card['preview_products']);

        // Discounted first — given five slots, the ones worth showing are the
        // ones with a price cut on them.
        $names = collect($card['preview_products'])->pluck('name')->all();
        $this->assertContains('Sugar', $names);
        $this->assertContains('Oil', $names);

        $sugar = collect($card['preview_products'])->firstWhere('name', 'Sugar');
        $this->assertSame(240.0, (float) $sugar['price']);
        $this->assertSame(300.0, (float) $sugar['original_price']);

        // …and a full-price item carries NO original price. A strike-through
        // against the same number is a discount badge that lies.
        $rice = collect($card['preview_products'])->firstWhere('name', 'Rice');
        if ($rice !== null) {
            $this->assertNull($rice['original_price']);
        }
    }

    public function test_a_shop_with_nothing_listed_still_gets_a_card(): void
    {
        // An empty preview is an empty array, not a missing key — a card that
        // has to check whether the field exists is a card that will one day
        // forget.
        $shop = Tenant::factory()->create([
            'online_shop_enabled' => true, 'setup_completed' => true,
            'business_type' => 'grocery', 'features' => BusinessTypes::defaultFeatures('grocery'),
        ]);

        $card = collect($this->getJson('/api/v1/marketplace/home')->assertOk()->json('data.nearby'))
            ->firstWhere('slug', $shop->slug);

        $this->assertSame([], $card['preview_products']);
    }
}
