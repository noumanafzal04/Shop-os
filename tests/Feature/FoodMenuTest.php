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
 * FoodPanda-style menu: modifier groups + options / add-ons, availability
 * windows, and modifier-aware online ordering.
 */
class FoodMenuTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $customer;

    private Product $pizza;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'online_shop_enabled' => true, 'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'restaurant', 'features' => BusinessTypes::defaultFeatures('restaurant'),
            'delivery_fee' => 100,
            // Pin to UTC so serving-window assertions built from now() are
            // deterministic (tz behaviour is covered explicitly elsewhere).
            'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->customer = User::factory()->create();
        $this->pizza = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => 'Pepperoni Pizza', 'price' => 1000, 'track_inventory' => false, 'visible_in_marketplace' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** Build a Crust (required, 1) + Extras (0..3) menu; return option ids. */
    private function syncMenu(): array
    {
        return $this->actingAsUser($this->owner)->putJson("/api/v1/products/{$this->pizza->id}/modifier-groups", [
            'groups' => [
                ['name' => 'Crust', 'type' => 'modifier', 'min_select' => 1, 'max_select' => 1, 'options' => [
                    ['name' => 'Thin', 'price_delta' => 0],
                    ['name' => 'Stuffed', 'price_delta' => 200],
                ]],
                ['name' => 'Extra Toppings', 'type' => 'addon', 'min_select' => 0, 'max_select' => 3, 'options' => [
                    ['name' => 'Cheese', 'price_delta' => 150],
                    ['name' => 'Olives', 'price_delta' => 100],
                ]],
            ],
        ])->assertOk()->json('data.modifier_groups');
    }

    private function optionId(array $groups, string $groupName, string $optionName): string
    {
        $g = collect($groups)->firstWhere('name', $groupName);

        return collect($g['options'])->firstWhere('name', $optionName)['id'];
    }

    // ── Authoring ───────────────────────────────────────────────────

    public function test_sync_creates_and_replaces_modifier_groups(): void
    {
        $groups = $this->syncMenu();
        $this->assertCount(2, $groups);
        $this->assertCount(2, $groups[0]['options']);

        // Re-sync with a single group → replaces entirely.
        $again = $this->actingAsUser($this->owner)->putJson("/api/v1/products/{$this->pizza->id}/modifier-groups", [
            'groups' => [['name' => 'Size', 'min_select' => 1, 'max_select' => 1, 'options' => [['name' => 'Regular']]]],
        ])->assertOk()->json('data.modifier_groups');
        $this->assertCount(1, $again);
        $this->assertSame('Size', $again[0]['name']);
    }

    public function test_min_cannot_exceed_max(): void
    {
        $this->actingAsUser($this->owner)->putJson("/api/v1/products/{$this->pizza->id}/modifier-groups", [
            'groups' => [['name' => 'Bad', 'min_select' => 3, 'max_select' => 1, 'options' => [['name' => 'X']]]],
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['groups.0.min_select']]);
    }

    // ── Marketplace display ─────────────────────────────────────────

    public function test_marketplace_shows_modifiers_and_availability(): void
    {
        $this->syncMenu();
        $products = $this->actingAsUser($this->customer)
            ->getJson("/api/v1/marketplace/shops/{$this->shop->slug}/products")->json('data');
        $p = collect($products)->firstWhere('name', 'Pepperoni Pizza');

        $this->assertCount(2, $p['modifier_groups']);
        $this->assertTrue($p['available_now']); // no window set → always available
    }

    public function test_availability_window_hides_item_out_of_hours(): void
    {
        // A window two hours in the future → not available now.
        $from = now()->addHours(2)->format('H:i');
        $until = now()->addHours(4)->format('H:i');
        $this->actingAsUser($this->owner)->putJson("/api/v1/products/{$this->pizza->id}", [
            'available_from' => $from, 'available_until' => $until,
        ])->assertOk();

        $products = $this->actingAsUser($this->customer)
            ->getJson("/api/v1/marketplace/shops/{$this->shop->slug}/products")->json('data');
        $p = collect($products)->firstWhere('name', 'Pepperoni Pizza');
        $this->assertFalse($p['available_now']);
    }

    // ── Modifier-aware ordering ─────────────────────────────────────

    public function test_order_applies_modifier_price_deltas_and_snapshots(): void
    {
        $groups = $this->syncMenu();
        $stuffed = $this->optionId($groups, 'Crust', 'Stuffed'); // +200
        $cheese = $this->optionId($groups, 'Extra Toppings', 'Cheese'); // +150

        $order = $this->actingAsUser($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'pickup',
            'items' => [[
                'product_id' => $this->pizza->id, 'quantity' => 2,
                'modifier_option_ids' => [$stuffed, $cheese],
            ]],
        ])->assertCreated()->json('data');

        // Base 1000 + 200 + 150 = 1350 each × 2 = 2700
        $this->assertSame('1350.00', $order['items'][0]['unit_price']);
        $this->assertEquals(2700, $order['subtotal']);
        $this->assertCount(2, $order['items'][0]['modifiers']);
    }

    public function test_required_group_enforced(): void
    {
        $this->syncMenu(); // Crust is required (min 1)
        $this->actingAsUser($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $this->pizza->id, 'quantity' => 1, 'modifier_option_ids' => []]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'MODIFIER_MIN');
    }

    public function test_max_select_enforced(): void
    {
        $groups = $this->syncMenu();
        $thin = $this->optionId($groups, 'Crust', 'Thin');
        $stuffed = $this->optionId($groups, 'Crust', 'Stuffed');
        // Crust max 1, selecting both → too many.
        $this->actingAsUser($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $this->pizza->id, 'quantity' => 1, 'modifier_option_ids' => [$thin, $stuffed]]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'MODIFIER_MAX');
    }

    public function test_invalid_option_rejected(): void
    {
        $this->syncMenu();
        $this->actingAsUser($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $this->pizza->id, 'quantity' => 1, 'modifier_option_ids' => ['019f0000-0000-7000-8000-000000000000']]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'MODIFIER_INVALID');
    }

    public function test_staff_without_products_permission_cannot_edit_menu(): void
    {
        $staff = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create();
        $this->actingAsUser($staff)->putJson("/api/v1/products/{$this->pizza->id}/modifier-groups", ['groups' => []])
            ->assertStatus(403);
    }
}
