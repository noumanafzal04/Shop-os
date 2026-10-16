<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\City;
use App\Models\Customer;
use App\Models\CustomerLedgerEntry;
use App\Models\Product;
use App\Models\Register;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * MONEY PAID AGAINST KHATA IS SEEN — AND IS NEVER A SALE TWICE (L14).
 *
 * The owner, from Ali Raza's card (2026-10-15): "ye sales main show hogi and
 * report main count?" The credit sale is counted on the day it is rung, at its
 * full amount. The payment later is a collection. A cash one reached the
 * drawer; a transfer, card or wallet one reached no screen at all.
 */
class KhataCollectedIsNotASaleTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Branch $main;

    private Branch $town;

    private Product $rice;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'),
            'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->main = Branch::withoutTenancy()->where('tenant_id', $this->shop->id)->where('is_default', true)->firstOrFail();
        $this->town = Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Johar Town', 'code' => 'JT',
            'is_default' => false, 'is_active' => true, 'city_id' => $city->id,
        ]);
        $this->rice = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'name' => 'Rice Bag',
            'price' => 2000, 'cost' => 1500, 'track_inventory' => false, 'is_active' => true,
        ]);
    }

    private function as(User $user, ?Branch $at = null): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $this->withToken($token);

        return $at === null ? $this : $this->withHeader('X-Branch-Id', $at->id);
    }

    /** A day at Main with a drawer, and Ali's 2,000 sale on khata in it. */
    private function aCreditSaleAtMain(): Customer
    {
        $register = Register::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'branch_id' => $this->main->id, 'name' => 'Lane 1', 'code' => 'L1', 'is_active' => true,
        ]);
        $session = $this->as($this->owner, $this->main)
            ->postJson('/api/v1/pos/session/open', ['register_id' => $register->id, 'opening_float' => 1000])
            ->assertCreated()->json('data.id');

        $this->as($this->owner, $this->main)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'cash_session_id' => $session, 'payment_method' => 'credit', 'amount_paid' => 2000,
            'customer_name' => 'Ali Raza', 'customer_phone' => '03000124123',
            'items' => [['product_id' => $this->rice->id, 'quantity' => 1]],
        ])->assertCreated();

        return Customer::withoutTenancy()->where('phone', '03000124123')->firstOrFail();
    }

    private function pay(Customer $ali, Branch $at, float $amount, string $method): void
    {
        $this->as($this->owner, $at)->postJson("/api/v1/customers/{$ali->id}/payments", ['amount' => $amount, 'method' => $method])
            ->assertCreated();
    }

    public function test_the_report_shows_what_was_collected_beside_the_sales_and_not_in_them(): void
    {
        $ali = $this->aCreditSaleAtMain();
        $this->pay($ali, $this->main, 1500, 'bank_transfer');
        $this->pay($ali, $this->main, 500, 'cash');
        // A return takes the khata down too. It is not money handed over.
        $ali->refresh()->recordCreditPayment(100, 'return', 'RET-000001');

        $today = now()->toDateString();
        $report = $this->as($this->owner)->getJson("/api/v1/reports/summary?period=custom&from={$today}&to={$today}")->assertOk()->json('data');

        $this->assertEquals(2000, $report['totals']['revenue'], 'the sale is counted once, on its day — the payments are not sales');
        $this->assertEquals(2000, $report['collections']['total']);
        $this->assertSame(2, $report['collections']['count']);
        $this->assertEquals(
            ['bank_transfer' => 1500, 'cash' => 500],
            collect($report['collections']['by_method'])->mapWithKeys(fn ($m) => [$m['method'] => (float) $m['total']])->all(),
        );
    }

    public function test_the_day_lists_its_branchs_collections_and_its_sales_stay_its_sales(): void
    {
        $ali = $this->aCreditSaleAtMain();
        $this->pay($ali, $this->main, 1500, 'bank_transfer');
        // Taken at the other counter — that branch's money, not Main's day.
        $this->pay($ali, $this->town, 300, 'wallet');
        // From before a payment said where it was taken: nobody's day.
        CustomerLedgerEntry::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'customer_id' => $ali->id, 'type' => 'payment',
            'amount' => 50, 'balance_after' => 150, 'method' => 'cash',
        ]);

        $day = $this->as($this->owner, $this->main)->getJson('/api/v1/pos/day')->assertOk()->json('data');

        $this->assertEquals(2000, $day['running']['sales_total']);
        $this->assertEquals(1500, $day['collections']['total']);
        $this->assertSame(1, $day['collections']['count']);
        $this->assertSame('Ali Raza', $day['collections']['entries'][0]['customer']['name']);
        $this->assertSame('bank_transfer', $day['collections']['entries'][0]['method']);
    }

    public function test_a_day_reader_without_the_customer_book_is_not_sent_it(): void
    {
        $ali = $this->aCreditSaleAtMain();
        $this->pay($ali, $this->main, 1500, 'bank_transfer');
        $cashier = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create();

        $day = $this->as($cashier, $this->main)->getJson('/api/v1/pos/day')->assertOk()->json('data');

        $this->assertArrayHasKey('collections', $day);
        $this->assertNull($day['collections'], 'customers\' names and payments reached somebody who does not keep the customer book');
    }
}
