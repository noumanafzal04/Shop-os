<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\CustomerGroup;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Customer groups (tiered pricing). A member's sales price at the group's
 * default level (retail | wholesale) and apply the group's automatic members'
 * discount — all server-authoritative, resolved from the linked customer.
 */
class CustomerGroupTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Product $widget; // retail 100 / wholesale 80

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'), 'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->widget = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Widget', 'price' => 100, 'wholesale_price' => 80,
            'stock_quantity' => 500, 'track_inventory' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function group(array $over): CustomerGroup
    {
        return CustomerGroup::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->tenant->id, 'name' => 'Group', 'price_level' => 'retail', 'is_active' => true,
        ], $over));
    }

    private function member(string $phone, ?CustomerGroup $group): Customer
    {
        return Customer::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Trade Buyer', 'phone' => $phone,
            'customer_group_id' => $group?->id,
        ]);
    }

    /** @param array<int, array{0: Product, 1: float, 2?: string}> $items */
    private function sell(array $items, ?string $phone): TestResponse
    {
        return $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 1000000,
            'customer_phone' => $phone,
            'items' => array_map(fn ($i) => array_filter([
                'product_id' => $i[0]->id, 'quantity' => $i[1], 'price_level' => $i[2] ?? null,
            ], fn ($v) => $v !== null), $items),
        ]);
    }

    public function test_wholesale_group_member_is_priced_at_wholesale_automatically(): void
    {
        $trade = $this->group(['name' => 'Trade', 'price_level' => 'wholesale']);
        $this->member('03001112233', $trade);

        // No per-line price_level sent — the group makes it wholesale (80).
        $sale = $this->sell([[$this->widget, 2]], '03001112233')->assertCreated()->json('data');

        $this->assertEquals(160, $sale['total']); // 2 × 80
    }

    public function test_non_member_pays_retail(): void
    {
        $this->group(['name' => 'Trade', 'price_level' => 'wholesale']); // exists but customer not in it
        $this->member('03009998877', null);

        $sale = $this->sell([[$this->widget, 2]], '03009998877')->assertCreated()->json('data');

        $this->assertEquals(200, $sale['total']); // 2 × 100 retail
    }

    public function test_walk_in_without_a_phone_pays_retail(): void
    {
        $this->group(['name' => 'Trade', 'price_level' => 'wholesale']);

        $sale = $this->sell([[$this->widget, 1]], null)->assertCreated()->json('data');

        $this->assertEquals(100, $sale['total']);
    }

    public function test_explicit_line_price_level_overrides_the_group_default(): void
    {
        $retailGroup = $this->group(['name' => 'VIP', 'price_level' => 'retail']);
        $this->member('03002223344', $retailGroup);

        // Line explicitly asks wholesale — that wins over the group's retail.
        $sale = $this->sell([[$this->widget, 1, 'wholesale']], '03002223344')->assertCreated()->json('data');

        $this->assertEquals(80, $sale['total']);
    }

    public function test_members_discount_percent_is_applied(): void
    {
        $vip = $this->group(['name' => 'VIP 10%', 'discount_percent' => 10]);
        $this->member('03005556677', $vip);

        // 1 widget @ 100 retail, 10% members' discount → 90.
        $sale = $this->sell([[$this->widget, 1]], '03005556677')->assertCreated()->json('data');

        $this->assertEquals(10, $sale['discount']);
        $this->assertEquals(90, $sale['total']);
        $this->assertNotNull($sale['customer_group_id']);
    }

    public function test_wholesale_and_members_discount_stack(): void
    {
        $trade = $this->group(['name' => 'Trade -5%', 'price_level' => 'wholesale', 'discount_percent' => 5]);
        $this->member('03007778899', $trade);

        // 2 × 80 wholesale = 160, then 5% off = 152.
        $sale = $this->sell([[$this->widget, 2]], '03007778899')->assertCreated()->json('data');

        $this->assertEquals(8, $sale['discount']);   // 5% of 160
        $this->assertEquals(152, $sale['total']);
    }

    // ── CRUD + assignment ────────────────────────────────────────────

    public function test_crud_and_assigning_a_customer(): void
    {
        $group = $this->actingAsUser($this->owner)->postJson('/api/v1/customer-groups', [
            'name' => 'Wholesale', 'price_level' => 'wholesale', 'discount_percent' => 5,
        ])->assertCreated()->json('data');

        $this->actingAsUser($this->owner)->getJson('/api/v1/customer-groups')
            ->assertOk()->assertJsonFragment(['name' => 'Wholesale']);

        $customer = $this->actingAsUser($this->owner)->postJson('/api/v1/customers', [
            'name' => 'Shopkeeper', 'phone' => '03001010101', 'customer_group_id' => $group['id'],
        ])->assertCreated()->json('data');
        $this->assertSame($group['id'], $customer['customer_group_id']);

        $this->actingAsUser($this->owner)->deleteJson("/api/v1/customer-groups/{$group['id']}")->assertOk();
        // Soft-deleted: the member's group relation resolves to null (the
        // SoftDeletes scope hides it), so they fall back to retail pricing.
        $this->assertNull(Customer::withoutTenancy()->find($customer['id'])->group);
    }

    public function test_a_group_created_without_a_price_level_charges_its_members_retail(): void
    {
        // The field is optional and the form always sends it, so what a group
        // made without one charges was never asked. Driven through to the
        // MONEY on purpose: a default that landed on wholesale would quietly
        // sell at 80 to everybody an owner put in a group they created in a
        // hurry, and nothing on any screen would say why.
        $id = $this->actingAsUser($this->owner)->postJson('/api/v1/customer-groups', [
            'name' => 'Regulars',
        ])->assertCreated()->json('data.id');

        $this->assertSame('retail', CustomerGroup::withoutTenancy()->find($id)->price_level);

        $this->member('03005556677', CustomerGroup::withoutTenancy()->find($id));

        $sale = $this->sell([[$this->widget, 2]], '03005556677')->assertCreated()->json('data');

        $this->assertEquals(200, $sale['total']); // 2 × 100 retail, not 2 × 80
    }

    public function test_invalid_price_level_is_rejected(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/customer-groups', [
            'name' => 'Bad', 'price_level' => 'platinum',
        ])->assertStatus(422)->assertJsonValidationErrors(['price_level']);
    }
}
