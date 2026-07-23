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
}
