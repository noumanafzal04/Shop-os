<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\PurchaseOrder;
use App\Models\Supplier;
use App\Models\Tenant;
use App\Models\User;
use App\Services\DashboardService;
use App\Support\BusinessTypes;
use App\Support\StaffPresets;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE DASHBOARD TELLS EACH PERSON THEIR SHARE — AND THE SERVER LEAVES THE REST OUT.
 *
 * Tester pass 2 (B39): only profit and expenses were stripped. The kitchen at
 * Johar Café was sent the day's 515,554 of takings and both places' revenue;
 * the stock keeper, the cashier and the online-orders desk at Zari were sent
 * what the shop owes its suppliers (29,400) and the shop's audit feed.
 *
 * Takings → whoever sells or reads the reports. Khata owed to the shop →
 * whoever keeps customers. What the shop owes → whoever buys, pays or reads
 * the books (the owner, 2026-10-14, Q9). The audit feed → READS_AUDIT. Every
 * place side by side → the owner; staff keep their own place's row.
 */
class TheDashboardTellsEachPersonTheirShareTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();

        $item = $this->as($this->owner)->postJson('/api/v1/products', [
            'name' => 'Basmati 5kg', 'item_type' => 'physical_product', 'price' => 5000, 'cost' => 3000, 'track_inventory' => false,
        ])->assertCreated()->json('data');
        $this->as($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'items' => [['product_id' => $item['id'], 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 5000,
        ])->assertCreated();

        Customer::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => 'Ayesha', 'phone' => '03001234567', 'credit_balance' => 3200]);
        $mill = Supplier::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => 'Rehmat Traders', 'is_active' => true]);
        PurchaseOrder::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'supplier_id' => $mill->id, 'po_number' => 'PO-000001', 'status' => 'received',
            'order_date' => now()->toDateString(), 'subtotal' => 15000, 'total' => 15000, 'received_total' => 15000, 'amount_paid' => 0,
        ]);
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function preset(string $code): User
    {
        return User::factory()->create([
            'tenant_id' => $this->shop->id, 'role' => 'staff',
            'permissions' => collect(StaffPresets::all())->firstWhere('code', $code)['permissions'],
        ]);
    }

    /** @return array<string, mixed> */
    private function dashboard(User $user): array
    {
        return $this->as($user)->getJson('/api/v1/dashboard')->assertOk()->json('data');
    }

    private function assertNoTakings(array $d, string $who): void
    {
        $this->assertFalse($d['sees']['takings'], $who);
        foreach (['today', 'period'] as $block) {
            foreach (['revenue', 'refunds', 'sales_count', 'customers_count'] as $key) {
                $this->assertNull($d[$block][$key], "{$who} was sent the {$block} {$key}");
            }
            $this->assertNull($d[$block]['deltas']['revenue'], "{$who} could work the takings out from their change");
        }
        foreach ($d['sales_series'] as $point) {
            $this->assertNull($point['revenue'], "{$who} could read the takings off the chart");
        }
        $this->assertSame([], $d['recent_sales'], "{$who} was sent the latest sales");
        $this->assertNull($d['till'], "{$who} was sent the till");
    }

    public function test_the_kitchen_is_sent_no_money_at_all(): void
    {
        $d = $this->dashboard($this->preset('kitchen'));

        $this->assertNoTakings($d, 'the kitchen');
        $this->assertNull($d['money_owed']['receivable'], 'the kitchen was sent the khata book');
        $this->assertNull($d['money_owed']['payable'], 'the kitchen was sent what the shop owes');
        $this->assertSame([null, null, null, null], array_values($d['highlights']), 'the kitchen was sent the leaders by revenue');
        $this->assertSame([], $d['activity'], 'the kitchen was sent the audit feed');
    }

    public function test_the_stock_keeper_keeps_the_shelf_and_loses_the_money(): void
    {
        $d = $this->dashboard($this->preset('stock_keeper'));

        $this->assertNoTakings($d, 'the stock keeper');
        $this->assertNull($d['money_owed']['payable'], 'the stock keeper was sent what the shop owes its suppliers');
        $this->assertSame([], $d['activity'], 'the stock keeper was sent the audit feed');
        // What the job needs is still there.
        $this->assertArrayHasKey('low_stock', $d['inventory']);
    }

    public function test_the_cashier_keeps_the_till_and_the_khata(): void
    {
        $d = $this->dashboard($this->preset('cashier'));

        $this->assertTrue($d['sees']['takings']);
        $this->assertEquals(5000, $d['today']['revenue'], 'the cashier lost the day they rang up');
        $this->assertNotEmpty($d['recent_sales']);
        $this->assertEquals(3200, $d['money_owed']['receivable']['total'], 'the cashier takes khata and lost the khata book');
        $this->assertNull($d['money_owed']['payable'], 'the cashier was sent what the shop owes its suppliers');
        $this->assertSame([], $d['activity'], 'the cashier was sent the audit feed');
        $this->assertSame([null, null, null, null], array_values($d['highlights']), 'the cashier was sent the staff ranked by revenue');
    }

    public function test_the_owner_and_the_buyer_see_what_they_answer_for(): void
    {
        $owner = $this->dashboard($this->owner);
        $this->assertEquals(5000, $owner['today']['revenue']);
        $this->assertEquals(3200, $owner['money_owed']['receivable']['total']);
        $this->assertEquals(15000, $owner['money_owed']['payable']['total']);
        $this->assertNotEmpty($owner['activity'], 'the owner lost the audit feed');
        $this->assertNotNull($owner['highlights']['top_product']);

        $buyer = $this->dashboard($this->preset('buyer'));
        $this->assertEquals(15000, $buyer['money_owed']['payable']['total'], 'whoever pays the supplier lost what is owed');
        $this->assertNull($buyer['today']['revenue'], 'the buyer was sent the takings');
    }

    public function test_every_place_side_by_side_is_the_owners(): void
    {
        $figures = [
            'branch_scope' => 'main', 'today' => [], 'period' => [], 'sales_series' => [],
            'expense_breakdown' => [], 'recent_expenses' => [], 'books' => null, 'recent_sales' => [], 'till' => null,
            'highlights' => ['top_product' => null], 'money_owed' => ['receivable' => null, 'payable' => null], 'activity' => [],
            'branches' => [
                ['branch_id' => 'main', 'branch' => 'Main', 'sales_count' => 4, 'revenue' => 9000.0],
                ['branch_id' => 'outlet', 'branch' => 'Outlet', 'sales_count' => 2, 'revenue' => 3000.0],
            ],
        ];
        foreach (['today', 'period'] as $block) {
            $figures[$block] = ['revenue' => 1, 'refunds' => 0, 'sales_count' => 1, 'customers_count' => 1, 'other_income' => 0,
                'expenses' => 0, 'profit' => 0, 'deltas' => ['revenue' => null, 'expenses' => null, 'profit' => null]];
        }

        $this->assertCount(2, DashboardService::asSeenBy($figures, $this->owner)['branches']);

        $manager = DashboardService::asSeenBy($figures, $this->preset('manager'))['branches'];
        $this->assertSame(['main'], array_column($manager, 'branch_id'), 'a manager pinned to Main was sent the Outlet\'s takings');

        $this->assertSame([], DashboardService::asSeenBy($figures, $this->preset('kitchen'))['branches'], 'the kitchen was sent its own place\'s takings');
    }
}
