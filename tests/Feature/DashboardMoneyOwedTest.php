<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\PurchaseOrder;
use App\Models\Supplier;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Who owes whom.
 *
 * Straight after "what did I take today" an owner asks two questions the
 * dashboard could not answer at all: how much is out on khata, and how much do
 * I owe my suppliers. Both are already recorded — one on the customer, one
 * across purchase orders — and neither was ever surfaced anywhere a shopkeeper
 * would look daily.
 */
class DashboardMoneyOwedTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    public function test_khata_owed_to_the_shop_is_summed_across_accounts(): void
    {
        $this->customer('Bilal', 3200);
        $this->customer('Nadia', 800);

        $owed = $this->dashboard()['money_owed']['receivable'];

        $this->assertEquals(4000, $owed['total']);
        $this->assertSame(2, $owed['accounts']);
    }

    public function test_a_customer_in_credit_is_not_a_debt(): void
    {
        $this->customer('Bilal', 3200);
        // An advance, or an over-settled khata. Netting it against what others
        // owe would report a book half the size it really is.
        $this->customer('Ayesha', -1200);

        $owed = $this->dashboard()['money_owed']['receivable'];

        $this->assertEquals(3200, $owed['total']);
        $this->assertSame(1, $owed['accounts']);
    }

    public function test_supplier_payables_count_only_what_was_actually_ordered(): void
    {
        $supplier = $this->supplier('Rehmat Traders');

        $this->purchase($supplier, 'ordered', total: 50000, paid: 20000);
        $this->purchase($supplier, 'received', total: 15000, paid: 15000);   // settled
        // A draft is a shopping list, not a bill. A cancelled one is neither.
        $this->purchase($supplier, 'draft', total: 90000, paid: 0);
        $this->purchase($supplier, 'cancelled', total: 40000, paid: 0);

        $owed = $this->dashboard()['money_owed']['payable'];

        $this->assertEquals(30000, $owed['total']);
        $this->assertSame(1, $owed['accounts']);
    }

    public function test_payables_are_counted_per_supplier_not_per_order(): void
    {
        $a = $this->supplier('Rehmat Traders');
        $b = $this->supplier('Al-Fajar Distributors');

        $this->purchase($a, 'ordered', total: 10000, paid: 0);
        $this->purchase($a, 'ordered', total: 5000, paid: 0);
        $this->purchase($b, 'partially_received', total: 8000, paid: 3000);

        $owed = $this->dashboard()['money_owed']['payable'];

        $this->assertEquals(20000, $owed['total']);
        // "Two people are waiting to be paid" is the number an owner acts on.
        $this->assertSame(2, $owed['accounts']);
    }

    public function test_a_books_only_shop_is_asked_about_neither(): void
    {
        // Finance Manager: no catalog, no till, no stock. It buys nothing and
        // sells nothing, so both figures are an honest zero rather than a query.
        $this->shop->forceFill(['features' => ['expenses' => true]])->save();

        $owed = $this->dashboard()['money_owed'];

        $this->assertEquals(0, $owed['receivable']['total']);
        $this->assertEquals(0, $owed['payable']['total']);
    }

    // ── Helpers ─────────────────────────────────────────────────────

    /** @return array<string, mixed> */
    private function dashboard(): array
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token)->getJson('/api/v1/dashboard')->assertOk()->json('data');
    }

    private function customer(string $name, float $balance): Customer
    {
        return Customer::withoutTenancy()->create([
            'tenant_id' => $this->shop->id,
            'name' => $name,
            'phone' => '03'.random_int(10000000, 99999999),
            'credit_balance' => $balance,
        ]);
    }

    private function supplier(string $name): Supplier
    {
        return Supplier::withoutTenancy()->create([
            'tenant_id' => $this->shop->id,
            'name' => $name,
            'is_active' => true,
        ]);
    }

    private function purchase(Supplier $supplier, string $status, float $total, float $paid): PurchaseOrder
    {
        return PurchaseOrder::withoutTenancy()->create([
            'tenant_id' => $this->shop->id,
            'supplier_id' => $supplier->id,
            'po_number' => 'PO-'.str_pad((string) random_int(1, 999999), 6, '0', STR_PAD_LEFT),
            'status' => $status,
            'order_date' => now()->toDateString(),
            'subtotal' => $total,
            'total' => $total,
            'amount_paid' => $paid,
        ]);
    }
}
