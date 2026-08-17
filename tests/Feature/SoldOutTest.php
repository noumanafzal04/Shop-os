<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * "Eighty-six the fish."
 *
 * ── The hole ────────────────────────────────────────────────────────────
 *
 * A kitchen runs out mid-service and the till kept selling. Not a bug — a
 * consequence of a deliberate decision written into InventoryService:
 *
 *     "Recipe/BOM ingredient depletion passes allow_negative: a dish is made
 *      to order, so an under-recorded ingredient must never block the sale."
 *
 * Which is right. Refusing to settle a dine-in tab for food already eaten is
 * worse than a negative stock figure. But it also means a dish can never BE
 * out of stock, so a sold-out fish went on selling all evening, to every table
 * that asked.
 *
 * The only workaround was deactivating the product — a catalog edit that also
 * strips it from the storefront, records no reason and no time, and that
 * nobody reverses for twenty dishes at eleven at night.
 */
class SoldOutTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $cashier;

    private Product $fish;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'food', 'features' => BusinessTypes::defaultFeatures('food'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->cashier = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create();

        $this->fish = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => 'Grilled fish', 'price' => 1800, 'track_inventory' => false, 'is_active' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withHeader('Authorization', "Bearer {$token}");
    }

    private function eightySix(?User $who = null): TestResponse
    {
        return $this->actingAsUser($who ?? $this->owner)
            ->postJson("/api/v1/products/{$this->fish->id}/sold-out");
    }

    public function test_a_dish_can_be_taken_off_the_menu(): void
    {
        $this->eightySix()->assertOk();

        $this->assertNotNull($this->fish->fresh()->sold_out_at);
    }

    public function test_the_till_refuses_to_sell_it(): void
    {
        // The load-bearing assertion. Hiding it in the catalog is not enough:
        // a till holds the menu in memory from opening, and an offline till
        // certainly does — so the refusal has to live on this side.
        $this->eightySix();

        $this->actingAsUser($this->cashier)
            ->postJson('/api/v1/sales', [
                'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 1800,
                'items' => [['product_id' => $this->fish->id, 'quantity' => 1]],
            ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'ITEM_SOLD_OUT');
    }

    public function test_it_sells_again_the_moment_it_is_put_back(): void
    {
        $this->eightySix();
        $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/products/{$this->fish->id}/sold-out")
            ->assertOk();

        $this->assertNull($this->fish->fresh()->sold_out_at);

        $this->actingAsUser($this->cashier)
            ->postJson('/api/v1/sales', [
                'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 1800,
                'items' => [['product_id' => $this->fish->id, 'quantity' => 1]],
            ])
            ->assertCreated();
    }

    public function test_pressing_it_twice_keeps_the_first_time(): void
    {
        // "Off since Tuesday" is the sentence that gets a forgotten dish turned
        // back on. Re-stamping on every press would erase exactly that, which
        // is the whole reason this is a timestamp and not a flag.
        $this->eightySix();
        $first = $this->fish->fresh()->sold_out_at;

        $this->travel(2)->hours();
        $this->eightySix()->assertOk();

        $this->assertEquals($first, $this->fish->fresh()->sold_out_at);
    }

    public function test_it_records_who_called_it(): void
    {
        // A dish that has been off for three days is a conversation with
        // somebody, and "nobody knows who" ends it.
        $this->eightySix();

        $this->assertSame($this->owner->id, $this->fish->fresh()->sold_out_by);
    }

    public function test_a_cashier_ringing_a_queue_cannot_take_a_dish_off(): void
    {
        // products.manage, not sales.manage. A mis-tap at the till must not
        // remove a dish from the menu for the whole shop.
        $this->eightySix($this->cashier)->assertForbidden();

        $this->assertNull($this->fish->fresh()->sold_out_at);
    }

    public function test_being_sold_out_is_not_the_same_as_being_deactivated(): void
    {
        // Two different decisions with two different lifetimes: `is_active` is
        // a catalog edit made once, this is a service call undone tomorrow.
        // Collapsing them would strip a dish from the storefront every dinner.
        $this->eightySix();
        $fresh = $this->fish->fresh();

        $this->assertTrue((bool) $fresh->is_active);
        $this->assertNotNull($fresh->sold_out_at);
    }

    public function test_the_till_is_told_which_items_are_off(): void
    {
        // Sent, never filtered out — a delta that simply omitted the dish is
        // indistinguishable from a tombstone, and would leave yesterday's copy
        // on the tablet still selling it.
        $this->eightySix();

        $rows = $this->actingAsUser($this->cashier)
            ->getJson('/api/v1/pos/catalog')
            ->assertOk()
            ->json('data.products.items');

        $row = collect($rows)->firstWhere('id', $this->fish->id);

        $this->assertNotNull($row, 'The dish must still reach the till, marked.');
        $this->assertTrue($row['sold_out']);
    }
}
