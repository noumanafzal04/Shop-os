<?php

namespace Tests\Feature;

use App\Models\BranchSoldOut;
use App\Models\City;
use App\Models\DiningTable;
use App\Models\Order;
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

    private User $customer;

    private Product $fish;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            // Open to shoppers as well as to the counter — the whole point of
            // the tests at the bottom of this file is that there are two.
            'online_shop_enabled' => true,
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'food', 'features' => BusinessTypes::defaultFeatures('food'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->cashier = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create();
        $this->customer = User::factory()->create();

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

    /**
     * The row IS the fact now — there is no flag on the product.
     *
     * Keyed on a branch, because a kitchen runs out and a chain does not: these
     * tests run a single-branch shop, so "off here" and "off" are the same
     * sentence and the assertions read the same as they always did.
     */
    private function offRow(): ?BranchSoldOut
    {
        return BranchSoldOut::withoutTenancy()
            ->where('product_id', $this->fish->id)
            ->whereNull('variant_id')
            ->first();
    }

    public function test_a_dish_can_be_taken_off_the_menu(): void
    {
        $this->eightySix()->assertOk();

        $this->assertNotNull($this->offRow());
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

        $this->assertNull($this->offRow());

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
        $first = $this->offRow()?->sold_out_at;

        $this->travel(2)->hours();
        $this->eightySix()->assertOk();

        $this->assertEquals($first, $this->offRow()?->sold_out_at);
    }

    public function test_it_records_who_called_it(): void
    {
        // A dish that has been off for three days is a conversation with
        // somebody, and "nobody knows who" ends it.
        $this->eightySix();

        $this->assertSame($this->owner->id, $this->offRow()?->sold_out_by);
    }

    public function test_a_cashier_ringing_a_queue_cannot_take_a_dish_off(): void
    {
        // products.manage, not sales.manage. A mis-tap at the till must not
        // remove a dish from the menu for the whole shop.
        $this->eightySix($this->cashier)->assertForbidden();

        $this->assertNull($this->offRow());
    }

    public function test_being_sold_out_is_not_the_same_as_being_deactivated(): void
    {
        // Two different decisions with two different lifetimes: `is_active` is
        // a catalog edit made once, this is a service call undone tomorrow.
        // Collapsing them would strip a dish from the storefront every dinner.
        $this->eightySix();
        $fresh = $this->fish->fresh();

        $this->assertTrue((bool) $fresh->is_active);
        $this->assertNotNull($this->offRow());
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

    // ── The other counter ───────────────────────────────────────────
    //
    // Every test above this line asks the till. That is where the button was
    // born and it is the only place anybody thought to look — which is exactly
    // how a shop ends up with a dish that is off at the counter and on in the
    // app. The kitchen makes one decision; two paths were answering it.

    public function test_the_app_refuses_it_too(): void
    {
        $this->eightySix();

        $this->actingAsUser($this->customer)
            ->postJson('/api/v1/customer/orders', [
                'shop_slug' => $this->shop->slug,
                'fulfillment_type' => 'pickup',
                'items' => [['product_id' => $this->fish->id, 'quantity' => 1]],
            ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'ITEM_SOLD_OUT');
    }

    public function test_a_phone_order_is_stopped_too(): void
    {
        // A shopkeeper taking an order down the phone is relaxed past
        // `visible_in_marketplace` on purpose — publishing is their business.
        // Running out is not a publishing decision, and promising food that
        // does not exist is the same broken promise either way.
        $this->eightySix();

        $this->actingAsUser($this->owner)
            ->postJson('/api/v1/orders', [
                'customer_name' => 'Ayesha',
                'fulfillment_type' => 'pickup',
                'items' => [['product_id' => $this->fish->id, 'quantity' => 1]],
            ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'ITEM_SOLD_OUT');
    }

    public function test_the_public_menu_says_it_is_off_rather_than_hiding_it(): void
    {
        $this->eightySix();

        $rows = $this->getJson("/api/v1/marketplace/shops/{$this->shop->slug}/products")
            ->assertOk()
            ->json('data');

        $row = collect($rows)->firstWhere('id', $this->fish->id);

        // Listed, exactly as the till is still sent it: a dish that vanished
        // from the menu is indistinguishable from one the shop never sold, and
        // this comes back on when the delivery lands.
        $this->assertNotNull($row, 'The dish must stay on the menu, marked.');
        $this->assertTrue($row['sold_out']);
    }

    public function test_a_waiter_cannot_put_it_on_a_tab(): void
    {
        // THE FLOW 86 WAS INVENTED FOR, and the last one to learn it. A line
        // added to a tab prints a kitchen ticket, so this is the path where
        // selling what does not exist reaches the cook inside a minute — and
        // it was checking the serving window while ignoring the button beside
        // it.
        $this->eightySix();

        $table = DiningTable::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'T1', 'area' => 'Hall', 'seats' => 4,
        ]);

        $tab = $this->actingAsUser($this->owner)
            ->postJson('/api/v1/restaurant/tickets', [
                'order_type' => 'dine_in', 'dining_table_id' => $table->id, 'guest_count' => 2,
            ])
            ->assertCreated()
            ->json('data');

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/tickets/{$tab['id']}/items", [
                'items' => [['product_id' => $this->fish->id, 'quantity' => 1]],
            ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'ITEM_SOLD_OUT');
    }

    public function test_an_order_taken_before_the_kitchen_ran_out_can_still_be_completed(): void
    {
        // THE REASON THE TILL EXEMPTS THE TRUSTED PATH, and the thing the fix
        // above must not break. The customer ordered while it was on, the
        // kitchen ran out afterwards, and the shop still has to be able to
        // close the bill for food that was already made.
        $order = $this->actingAsUser($this->customer)
            ->postJson('/api/v1/customer/orders', [
                'shop_slug' => $this->shop->slug,
                'fulfillment_type' => 'pickup',
                'items' => [['product_id' => $this->fish->id, 'quantity' => 1]],
            ])
            ->assertCreated()
            ->json('data');

        $this->eightySix();

        foreach (['confirmed', 'preparing', 'ready', 'completed'] as $step) {
            $this->actingAsUser($this->owner)
                ->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => $step])
                ->assertOk();
        }

        $this->assertNotNull(Order::query()->find($order['id'])->sale_id);
    }
}
