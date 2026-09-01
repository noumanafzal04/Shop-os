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

    /**
     * A KHATA NEEDS A PHONE, BECAUSE THE COUNTER HAS NOTHING ELSE TO ASK FOR.
     *
     * `StoreSaleRequest` carries `customer_phone` and no `customer_id`. Every
     * path that puts a name to a sale keys off the number: the group discount
     * lookup, the loyalty balance, `Customer::capture`, and the credit ledger
     * itself. Loyalty says it out loud — *"Redeeming points needs a customer —
     * add the customer's phone."*
     *
     * The CRM does not. Its form offers `Phone` as a plain optional box sitting
     * directly beside `Credit limit (khata) — blank = no limit`, so a shop can
     * grant fifty thousand rupees of credit to somebody the till can never
     * name. That is not a customer who is hard to bill; it is money that cannot
     * be lent, cannot be repaid and cannot be chased, and nothing says so until
     * a cashier is standing at the counter with the customer in front of them.
     *
     * Found by `scripts/untested-absence.py`: `phone` was supplied by all seven
     * tests that create a customer, so its absence was a branch nobody had
     * driven down.
     */
    public function test_a_credit_limit_cannot_be_given_to_a_customer_with_no_phone(): void
    {
        // A plain customer with no number is fine — plenty of shops keep a
        // directory of walk-in names, and nothing about that is a khata.
        $this->actingAsUser($this->owner)->postJson('/api/v1/customers', ['name' => 'Walk-in Ahmed'])
            ->assertCreated();

        // A credit limit is the difference. Refused, and refused ON THE PHONE
        // field, because that is the box the shopkeeper has to fill.
        $this->actingAsUser($this->owner)->postJson('/api/v1/customers', [
            'name' => 'Khata Ahmed',
            'credit_limit' => 50000,
        ])->assertStatus(422)->assertJsonValidationErrors('phone');

        // And the same on the way in through the back door: an existing
        // phone-less customer cannot be given a limit later either.
        $id = $this->actingAsUser($this->owner)->postJson('/api/v1/customers', ['name' => 'Later Ahmed'])
            ->assertCreated()->json('data.id');

        $this->actingAsUser($this->owner)->putJson("/api/v1/customers/{$id}", ['credit_limit' => 25000])
            ->assertStatus(422)->assertJsonValidationErrors('phone');

        // With a number, it goes through — the rule is about being reachable,
        // not about paperwork.
        $this->actingAsUser($this->owner)->putJson("/api/v1/customers/{$id}", [
            'phone' => '+923001239999', 'credit_limit' => 25000,
        ])->assertOk();
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

    public function test_overpaying_the_khata_is_refused_without_confirmation(): void
    {
        $customer = Customer::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Owes 500', 'phone' => '03004445555', 'credit_balance' => 500,
        ]);

        // Paying 800 against a 500 debt is refused (would silently bank a 300
        // advance) — surfaced as KHATA_OVERPAYMENT, balance untouched.
        $this->actingAsUser($this->owner)->postJson("/api/v1/customers/{$customer->id}/payments", [
            'amount' => 800, 'method' => 'cash',
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'KHATA_OVERPAYMENT');

        $this->assertEquals(500, $customer->fresh()->credit_balance);
    }

    public function test_overpayment_is_banked_as_an_advance_when_confirmed(): void
    {
        $customer = Customer::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Owes 500', 'phone' => '03006667777', 'credit_balance' => 500,
        ]);

        // With allow_advance the extra 300 is deliberately kept as an advance
        // (balance goes negative, the customer's favour).
        $this->actingAsUser($this->owner)->postJson("/api/v1/customers/{$customer->id}/payments", [
            'amount' => 800, 'method' => 'cash', 'allow_advance' => true,
        ])->assertCreated()->assertJsonPath('data.credit_balance', -300);

        $this->assertEquals(-300, $customer->fresh()->credit_balance);
    }

    public function test_exact_settlement_is_not_treated_as_overpayment(): void
    {
        $customer = Customer::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Owes 500', 'phone' => '03008889999', 'credit_balance' => 500,
        ]);

        $this->actingAsUser($this->owner)->postJson("/api/v1/customers/{$customer->id}/payments", [
            'amount' => 500, 'method' => 'cash',
        ])->assertCreated()->assertJsonPath('data.credit_balance', 0);
    }
}
