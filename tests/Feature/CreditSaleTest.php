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

class CreditSaleTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'grocery', 'features' => BusinessTypes::defaultFeatures('grocery'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Rice bag', 'sku' => 'RICE', 'price' => 600, 'cost' => 400,
            'stock_quantity' => 100, 'track_inventory' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    public function test_full_credit_sale_adds_to_customer_balance_and_ledger(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'credit', 'amount_paid' => 600,
            'customer_name' => 'Ali', 'customer_phone' => '03001234567',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated();

        $customer = Customer::withoutTenancy()->where('phone', '03001234567')->first();
        $this->assertEquals(600, $customer->credit_balance);
        $this->assertDatabaseHas('customer_ledger_entries', [
            'customer_id' => $customer->id, 'type' => 'charge', 'amount' => 600, 'balance_after' => 600,
        ]);
    }

    public function test_split_cash_plus_credit_only_owes_the_credit_part(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'customer_name' => 'Sara', 'customer_phone' => '03007654321',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
            'payments' => [
                ['method' => 'cash', 'amount' => 200],
                ['method' => 'credit', 'amount' => 400],
            ],
        ])->assertCreated();

        $customer = Customer::withoutTenancy()->where('phone', '03007654321')->first();
        $this->assertEquals(400, $customer->credit_balance);
    }

    public function test_credit_sale_without_customer_is_rejected(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'credit', 'amount_paid' => 600,
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'CREDIT_REQUIRES_CUSTOMER');
    }

    public function test_credit_limit_blocks_over_limit_sale(): void
    {
        Customer::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Capped', 'phone' => '03009999999', 'credit_limit' => 500,
        ]);

        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'credit', 'amount_paid' => 600,
            'customer_phone' => '03009999999',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'CREDIT_LIMIT_EXCEEDED');

        // Nothing charged (the whole sale rolled back).
        $this->assertEquals(0, Customer::withoutTenancy()->where('phone', '03009999999')->first()->credit_balance);
    }

    public function test_recording_a_payment_reduces_the_balance(): void
    {
        $customer = Customer::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Owes', 'phone' => '03001112222', 'credit_balance' => 1000,
        ]);

        $this->actingAsUser($this->owner)->postJson("/api/v1/customers/{$customer->id}/payments", [
            'amount' => 400, 'method' => 'cash',
        ])->assertCreated()->assertJsonPath('data.credit_balance', 600);

        $this->assertEquals(600, $customer->fresh()->credit_balance);
        $this->assertDatabaseHas('customer_ledger_entries', [
            'customer_id' => $customer->id, 'type' => 'payment', 'amount' => 400, 'balance_after' => 600,
        ]);
    }
}
