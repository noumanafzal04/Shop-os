<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Customer;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * SALES BY CUSTOMER (wholesale #W5).
 *
 * "What did Chenab Traders buy from us in October?" had no answer: ten
 * report tabs, none by customer, for a business whose every customer is an
 * account.
 */
class SalesByCustomerReportTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Product $oil;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id, 'timezone' => 'UTC',
            'business_type' => 'wholesale', 'features' => BusinessTypes::defaultFeatures('wholesale'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->oil = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Cooking Oil 1L', 'price' => 500, 'cost' => 450, 'stock_quantity' => 500, 'track_inventory' => true,
        ]);
    }

    public function test_each_customer_with_what_they_bought_what_went_on_the_account_and_what_they_owe(): void
    {
        $this->sell('Chenab Traders', '03001112222', 10, [['method' => 'credit', 'amount' => 5000]]);
        $this->sell('Chenab Traders', '03001112222', 4, [['method' => 'cash', 'amount' => 1000], ['method' => 'credit', 'amount' => 1000]]);
        $this->sell('Ravi Stores', '03003334444', 2, [['method' => 'cash', 'amount' => 1000]]);
        $this->sell(null, null, 1, [['method' => 'cash', 'amount' => 500]]);
        // A voided sale is not trade.
        $void = $this->sell('Ravi Stores', '03003334444', 6, [['method' => 'cash', 'amount' => 3000]]);
        Sale::withoutTenancy()->whereKey($void)->update(['status' => 'cancelled']);

        $data = $this->report();
        $rows = collect($data['customers'])->keyBy('name');

        // Biggest first.
        $this->assertSame(['Chenab Traders', 'Ravi Stores'], array_column($data['customers'], 'name'));
        $this->assertSame(2, $rows['Chenab Traders']['sales_count']);
        $this->assertSame(7000.0, (float) $rows['Chenab Traders']['revenue']);
        $this->assertSame(6000.0, (float) $rows['Chenab Traders']['on_khata']);
        $this->assertSame(6000.0, (float) $rows['Chenab Traders']['owes_now']);
        $this->assertSame(1, $rows['Ravi Stores']['sales_count']);
        $this->assertSame(0.0, (float) $rows['Ravi Stores']['on_khata']);
        // Walk-ins are a line of their own.
        $this->assertSame(['sales_count' => 1, 'revenue' => 500], ['sales_count' => $data['walk_in']['sales_count'], 'revenue' => (int) $data['walk_in']['revenue']]);
    }

    public function test_a_sale_outside_the_dates_is_not_in_them(): void
    {
        $this->sell('Chenab Traders', '03001112222', 2, [['method' => 'cash', 'amount' => 1000]]);

        $data = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/reports/customers?period=custom&from=2020-01-01&to=2020-01-31')
            ->assertOk()->json('data');

        $this->assertSame([], $data['customers']);
        $this->assertNull($data['walk_in']);
    }

    public function test_it_needs_reports_and_a_customer_book(): void
    {
        $booker = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE])->create();
        $this->actingAsUser($booker)->getJson($this->url())->assertForbidden();

        $this->tenant->applyModules(['customers' => false]);
        $this->actingAsUser($this->owner)->getJson($this->url())->assertForbidden();
    }

    /** @param array<int, array{method: string, amount: float|int}> $payments */
    private function sell(?string $name, ?string $phone, int $qty, array $payments): string
    {
        return $this->actingAsUser($this->owner)->postJson('/api/v1/sales', array_filter([
            'channel' => 'pos',
            'customer_name' => $name, 'customer_phone' => $phone,
            'items' => [['product_id' => $this->oil->id, 'quantity' => $qty]],
            'payments' => $payments,
        ], fn ($v) => $v !== null))->assertCreated()->json('data.id');
    }

    private function url(): string
    {
        return '/api/v1/reports/customers?period=custom&from='.now()->subDay()->toDateString().'&to='.now()->addDay()->toDateString();
    }

    /** @return array<string, mixed> */
    private function report(): array
    {
        return $this->actingAsUser($this->owner)->getJson($this->url())->assertOk()->json('data');
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
