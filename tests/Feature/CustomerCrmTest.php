<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Customer;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class CustomerCrmTest extends TestCase
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
            'business_type' => 'retail', 'features' => array_merge(BusinessTypes::defaultFeatures('retail'), ['customers' => true]), 'delivery_fee' => 0,
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Mug', 'price' => 500, 'stock_quantity' => 100, 'track_inventory' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function makeSale(string $name, string $phone): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'customer_name' => $name, 'customer_phone' => $phone,
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]], 'amount_paid' => 500,
        ])->assertCreated();
    }

    // ── Auto-capture ────────────────────────────────────────────────

    public function test_sale_with_phone_captures_and_links_customer(): void
    {
        $this->makeSale('Ayesha', '+923001234567');

        $customer = Customer::withoutTenancy()->where('phone', '+923001234567')->first();
        $this->assertNotNull($customer);
        $this->assertSame('Ayesha', $customer->name);
        $this->assertSame(1, $customer->sales()->count());
    }

    public function test_repeat_phone_is_one_customer(): void
    {
        $this->makeSale('Ayesha', '+923001234567');
        $this->makeSale('Ayesha K', '+923001234567');

        $this->assertSame(1, Customer::withoutTenancy()->where('phone', '+923001234567')->count());
        $this->assertSame('Ayesha K', Customer::withoutTenancy()->where('phone', '+923001234567')->first()->name);
    }

    public function test_walk_in_without_phone_is_not_captured(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]], 'amount_paid' => 500,
        ])->assertCreated();

        $this->assertSame(0, Customer::withoutTenancy()->count());
    }

    public function test_online_order_captures_customer_by_phone(): void
    {
        $buyer = User::factory()->create(['name' => 'Online Bob', 'phone' => '+923009998877']);
        $this->actingAsUser($buyer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated();

        $this->assertNotNull(Customer::withoutTenancy()->where('phone', '+923009998877')->first());
    }

    // ── CRUD + history ──────────────────────────────────────────────

    public function test_manual_add_and_duplicate_phone_rejected(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/customers', ['name' => 'Manual', 'phone' => '+92300111'])
            ->assertCreated();
        $this->actingAsUser($this->owner)->postJson('/api/v1/customers', ['name' => 'Dup', 'phone' => '+92300111'])
            ->assertStatus(422)->assertJsonStructure(['errors' => ['phone']]);
    }

    public function test_show_returns_history_and_totals(): void
    {
        $this->makeSale('Ayesha', '+923001234567'); // 500
        $this->makeSale('Ayesha', '+923001234567'); // 500
        $id = Customer::withoutTenancy()->where('phone', '+923001234567')->first()->id;

        $data = $this->actingAsUser($this->owner)->getJson("/api/v1/customers/{$id}")->json('data');
        $this->assertCount(2, $data['history']['sales']);
        $this->assertEquals(1000, $data['history']['total_spent']);
    }

    public function test_update_notes_and_delete(): void
    {
        $id = $this->actingAsUser($this->owner)->postJson('/api/v1/customers', ['name' => 'X', 'phone' => '+92300222'])->json('data.id');
        $this->actingAsUser($this->owner)->putJson("/api/v1/customers/{$id}", ['notes' => 'VIP, prefers pickup'])
            ->assertOk()->assertJsonPath('data.notes', 'VIP, prefers pickup');
        $this->actingAsUser($this->owner)->deleteJson("/api/v1/customers/{$id}")->assertOk();
        $this->assertSame(0, Customer::withoutTenancy()->count());
    }

    // ── Authz / isolation ───────────────────────────────────────────

    public function test_staff_without_permission_blocked(): void
    {
        $staff = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create();
        $this->actingAsUser($staff)->getJson('/api/v1/customers')->assertStatus(403);
    }

    public function test_customers_isolated_per_tenant(): void
    {
        $this->makeSale('Ayesha', '+923001234567');
        // The other shop needs the customer book too — otherwise this passes
        // on a 403 rather than on the list being empty, which is not isolation,
        // it is a locked door.
        $other = User::factory()->shopOwner(
            Tenant::factory()->create(['features' => ['customers' => true]]),
        )->create();
        $this->assertSame(0, $this->actingAsUser($other)->getJson('/api/v1/customers')->json('meta.pagination.total'));
    }
}
