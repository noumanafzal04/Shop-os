<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Customer;
use App\Models\CustomerGroup;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Permissions;
use App\Support\StaffPresets;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * SELLING ON KHATA IS A PERSON'S PERMISSION (wholesale #W6).
 *
 * An order booker who could not read a dealer's account put Rs 5,050 on it:
 * khata was gated only by the shop's Customers module, and no permission
 * existed for the owner to withhold.
 */
class SellingOnKhataIsAPermissionTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'wholesale', 'features' => BusinessTypes::defaultFeatures('wholesale'),
        ]);
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Cooking Oil 1L', 'price' => 545, 'cost' => 475,
            'stock_quantity' => 100, 'track_inventory' => true,
        ]);
    }

    public function test_a_booker_without_it_cannot_put_a_sale_on_a_dealers_khata_and_nothing_moves(): void
    {
        $booker = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE])->create();

        $this->actingAsUser($booker)->postJson('/api/v1/sales', $this->khataSale())
            ->assertForbidden()
            ->assertJsonPath('meta.error_code', 'KHATA_NOT_YOURS');

        $this->assertSame(0, Sale::withoutTenancy()->count());
        $this->assertSame(0.0, (float) Customer::withoutTenancy()->where('phone', '03001112222')->value('credit_balance'));

        // Cash is still his to take.
        $this->actingAsUser($booker)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 545,
        ])->assertCreated();
    }

    public function test_with_it_the_sale_goes_on_the_khata(): void
    {
        $cashier = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE, Permissions::SALES_ON_CREDIT])->create();

        $this->actingAsUser($cashier)->postJson('/api/v1/sales', $this->khataSale())->assertCreated();

        $this->assertSame(545.0, (float) Customer::withoutTenancy()->where('phone', '03001112222')->value('credit_balance'));
    }

    public function test_the_owner_needs_nothing_and_the_counter_presets_carry_it(): void
    {
        $owner = User::factory()->shopOwner($this->tenant)->create();
        $this->actingAsUser($owner)->postJson('/api/v1/sales', $this->khataSale())->assertCreated();

        $presets = collect(StaffPresets::all())->keyBy('code');
        foreach (['cashier', 'shift_supervisor', 'manager'] as $code) {
            $this->assertContains(Permissions::SALES_ON_CREDIT, $presets[$code]['permissions'], "{$code} lost khata");
        }
    }

    public function test_everyone_who_could_sell_on_khata_before_still_can(): void
    {
        // The migration: nothing that worked stops working.
        $seller = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE])->create();
        $stock = User::factory()->tenantStaff($this->tenant, [Permissions::INVENTORY_MANAGE])->create();

        (require database_path('migrations/2026_10_25_000002_selling_on_khata_is_a_permission.php'))->up();

        $this->assertContains(Permissions::SALES_ON_CREDIT, $seller->fresh()->permissions);
        $this->assertNotContains(Permissions::SALES_ON_CREDIT, $stock->fresh()->permissions);
    }

    // ── #W7: the cheaper list, picked by hand ───────────────────────

    public function test_picking_the_wholesale_price_by_hand_needs_the_discount_permission(): void
    {
        $this->product->forceFill(['wholesale_price' => 525])->save();
        $booker = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE])->create();
        $line = ['product_id' => $this->product->id, 'quantity' => 1, 'price_level' => 'wholesale'];

        $this->actingAsUser($booker)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'items' => [$line], 'payment_method' => 'cash', 'amount_paid' => 525,
        ])->assertForbidden()->assertJsonPath('meta.error_code', 'PRICE_LEVEL_NOT_YOURS');
        $this->assertSame(0, Sale::withoutTenancy()->count());

        // Retail is anybody's.
        $this->actingAsUser($booker)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'items' => [['price_level' => 'retail'] + $line], 'payment_method' => 'cash', 'amount_paid' => 545,
        ])->assertCreated();

        // With the permission, the wholesale price.
        $manager = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE, Permissions::DISCOUNTS_APPLY])->create();
        $this->actingAsUser($manager)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'items' => [$line], 'payment_method' => 'cash', 'amount_paid' => 525,
        ])->assertCreated()->assertJsonPath('data.total', '525.00');
    }

    public function test_a_customer_on_the_wholesale_list_gets_it_by_right(): void
    {
        $this->product->forceFill(['wholesale_price' => 525])->save();
        $group = CustomerGroup::query()->create(['tenant_id' => $this->tenant->id, 'name' => 'Dealers', 'price_level' => 'wholesale']);
        Customer::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Chenab Traders', 'phone' => '03001112222', 'customer_group_id' => $group->id,
        ]);
        $booker = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE])->create();

        $this->actingAsUser($booker)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'customer_name' => 'Chenab Traders', 'customer_phone' => '03001112222',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1, 'price_level' => 'wholesale']],
            'payment_method' => 'cash', 'amount_paid' => 525,
        ])->assertCreated();
    }

    /** @return array<string, mixed> */
    private function khataSale(): array
    {
        return [
            'channel' => 'pos',
            'customer_name' => 'Chenab Traders', 'customer_phone' => '03001112222',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
            'payments' => [['method' => 'credit', 'amount' => 545]],
        ];
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
