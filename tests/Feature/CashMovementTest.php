<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\CashMovement;
use App\Models\CashSession;
use App\Models\Customer;
use App\Models\Product;
use App\Models\Register;
use App\Models\Supplier;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * The cash-movement ledger — every rupee that enters or leaves a drawer for a
 * reason that isn't a sale.
 *
 * The bug this closes: `expected_cash` was `opening_float + cash_sales`, full
 * stop. So the owner taking money to the bank, petty cash for a rickshaw, a
 * supplier paid from the till and a khata repayment coming in were ALL reported
 * as variances — six fake shortages a day on six lanes, and a real theft
 * indistinguishable from a supervisor's uncounted pickup.
 */
class CashMovementTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private User $cashier;

    private Product $product;

    private Register $lane;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->cashier = User::factory()->tenantStaff($this->tenant, [
            'sales.void', 'sales.refund', 'sales.manage', 'customers.manage', 'purchases.manage', 'suppliers.manage',
        ])->create(['name' => 'Ayesha']);

        $main = Branch::withoutTenancy()
            ->where('tenant_id', $this->tenant->id)->where('is_default', true)->firstOrFail();
        $this->lane = Register::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $main->id, 'name' => 'Lane 1', 'is_active' => true,
        ]);

        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Rice 5kg', 'sku' => 'RICE-5', 'price' => 1000, 'cost' => 800,
            'stock_quantity' => 100, 'track_inventory' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function openShift(User $user, float $float = 5000): array
    {
        return $this->actingAsUser($user)->postJson('/api/v1/pos/session/open', [
            'opening_float' => $float, 'register_id' => $this->lane->id,
        ])->assertCreated()->json('data');
    }

    private function ringCashSale(User $user, string $sessionId, float $paid = 1000): array
    {
        return $this->actingAsUser($user)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'cash_session_id' => $sessionId, 'payment_method' => 'cash',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
            'amount_paid' => $paid,
        ])->assertCreated()->json('data');
    }

    private function close(User $user, float $counted): array
    {
        return $this->actingAsUser($user)
            ->postJson('/api/v1/pos/session/close', ['counted_cash' => $counted])
            ->assertOk()->json('data');
    }

    // ── The manual movements a cashier records ──────────────────────

    /** The headline case: banking the day's cash is not a shortage. */
    public function test_a_safe_drop_lowers_the_expected_cash_instead_of_reading_as_a_shortage(): void
    {
        $shift = $this->openShift($this->cashier, 5000);
        $this->ringCashSale($this->cashier, $shift['id']);   // +1000

        $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/session/movements', [
            'type' => 'drop', 'amount' => 4000, 'reason' => 'To the safe',
        ])->assertCreated()->assertJsonPath('data.direction', 'out');

        // 5000 float + 1000 sale − 4000 dropped = 2000 in the drawer.
        $closed = $this->close($this->cashier, 2000);

        $this->assertEquals(2000, $closed['expected_cash']);
        $this->assertEquals(0, $closed['variance']);
        $this->assertEquals(4000, $closed['cash_out']);
        // Before this ledger existed the same day looked like a 4,000 shortage.
    }

    public function test_a_paid_in_raises_the_expected_cash(): void
    {
        $shift = $this->openShift($this->cashier, 1000);

        $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/session/movements', [
            'type' => 'paid_in', 'amount' => 500, 'reason' => 'Owner added change',
        ])->assertCreated();

        $closed = $this->close($this->cashier, 1500);
        $this->assertEquals(1500, $closed['expected_cash']);
        $this->assertEquals(500, $closed['cash_in']);
        $this->assertEquals(0, $closed['variance']);
    }

    /** A pay-out of money that isn't there is a typo, not a movement. */
    public function test_you_cannot_take_out_more_than_the_drawer_holds(): void
    {
        $this->openShift($this->cashier, 1200);

        $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/session/movements', [
            'type' => 'drop', 'amount' => 50000,
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'INSUFFICIENT_DRAWER_CASH');

        $this->assertSame(0, CashMovement::withoutTenancy()->count());
    }

    /** Opening the drawer is an event worth recording — and carries no amount. */
    public function test_a_no_sale_is_recorded_with_no_amount_and_no_drawer_effect(): void
    {
        $shift = $this->openShift($this->cashier, 1000);

        $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/session/movements', [
            'type' => 'no_sale', 'amount' => 999, 'reason' => 'Gave change for a note',
        ])->assertCreated()
            ->assertJsonPath('data.direction', 'none')
            ->assertJsonPath('data.amount', '0.00');

        $closed = $this->close($this->cashier, 1000);
        $this->assertEquals(1000, $closed['expected_cash']);
        $this->assertEquals(0, $closed['cash_in']);
        $this->assertEquals(0, $closed['cash_out']);
        $this->assertSame($shift['id'], CashMovement::withoutTenancy()->first()->cash_session_id);
    }

    public function test_a_movement_needs_an_open_shift(): void
    {
        $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/session/movements', [
            'type' => 'paid_out', 'amount' => 100,
        ])->assertStatus(409)->assertJsonPath('meta.error_code', 'SHIFT_REQUIRED');
    }

    public function test_an_amount_is_required_for_a_money_movement(): void
    {
        $this->openShift($this->cashier, 1000);

        $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/session/movements', [
            'type' => 'paid_out',
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'AMOUNT_REQUIRED');
    }

    /** The system types are written by the flow that moved the money, never keyed at the till. */
    public function test_a_cashier_cannot_forge_a_system_movement(): void
    {
        $this->openShift($this->cashier, 1000);

        $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/session/movements', [
            'type' => 'khata_in', 'amount' => 5000,
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['type']]);
    }

    /** Two lanes trading at once keep their movements apart. */
    public function test_movements_belong_to_the_lane_that_recorded_them(): void
    {
        $lane2 = Register::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $this->lane->branch_id, 'name' => 'Lane 2', 'is_active' => true,
        ]);

        $mine = $this->openShift($this->cashier, 3000);
        $theirs = $this->actingAsUser($this->owner)->postJson('/api/v1/pos/session/open', [
            'opening_float' => 3000, 'register_id' => $lane2->id,
        ])->assertCreated()->json('data');

        $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/session/movements', [
            'type' => 'drop', 'amount' => 1000,
        ])->assertCreated();

        $this->assertEquals(2000, $this->close($this->cashier, 2000)['expected_cash']);
        // The other lane never saw that drop.
        $theirClose = $this->actingAsUser($this->owner)
            ->postJson('/api/v1/pos/session/close', ['counted_cash' => 3000])->assertOk()->json('data');
        $this->assertEquals(3000, $theirClose['expected_cash']);
        $this->assertSame($mine['id'], CashMovement::withoutTenancy()->first()->cash_session_id);
        $this->assertNotSame($theirs['id'], CashMovement::withoutTenancy()->first()->cash_session_id);
    }

    // ── The cash that other flows move ──────────────────────────────

    /** Khata collected in cash lands in the drawer — it used to read as an overage. */
    public function test_a_cash_khata_repayment_is_recorded_against_the_drawer(): void
    {
        $customer = Customer::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Bilal', 'phone' => '03001112233',
            'credit_balance' => 6000,
        ]);
        $this->openShift($this->cashier, 1000);

        $this->actingAsUser($this->cashier)->postJson("/api/v1/customers/{$customer->id}/payments", [
            'amount' => 6000, 'method' => 'cash',
        ])->assertCreated();

        $closed = $this->close($this->cashier, 7000);
        $this->assertEquals(6000, $closed['cash_in']);
        $this->assertEquals(7000, $closed['expected_cash']);
        $this->assertEquals(0, $closed['variance']);
    }

    /** …and a khata paid by transfer never touched the till. */
    public function test_a_bank_khata_repayment_does_not_touch_the_drawer(): void
    {
        $customer = Customer::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Bilal', 'phone' => '03001112244',
            'credit_balance' => 6000,
        ]);
        $this->openShift($this->cashier, 1000);

        $this->actingAsUser($this->cashier)->postJson("/api/v1/customers/{$customer->id}/payments", [
            'amount' => 6000, 'method' => 'bank_transfer',
        ])->assertCreated();

        $closed = $this->close($this->cashier, 1000);
        $this->assertEquals(0, $closed['cash_in']);
        $this->assertEquals(1000, $closed['expected_cash']);
    }

    /** Paying a supplier from the till takes cash out — it used to read as a shortage. */
    public function test_a_cash_supplier_payment_is_recorded_against_the_drawer(): void
    {
        $supplier = Supplier::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Fresh Farms', 'phone' => '03007778899',
        ]);
        $this->openShift($this->cashier, 5000);

        $this->actingAsUser($this->cashier)->postJson("/api/v1/suppliers/{$supplier->id}/payments", [
            'amount' => 3500, 'method' => 'cash',
        ])->assertCreated();

        $closed = $this->close($this->cashier, 1500);
        $this->assertEquals(3500, $closed['cash_out']);
        $this->assertEquals(1500, $closed['expected_cash']);
        $this->assertEquals(0, $closed['variance']);
    }

    // ── Voids: both legs on the ledger ──────────────────────────────

    /**
     * A void hands cash back. Both legs — the tender in and the refund out — are
     * now on the drawer, so the total still nets out AND the void is visible
     * with a name against it. Before, neither leg was recorded: a legitimate
     * void and a pocketed one balanced identically.
     */
    public function test_voiding_a_cash_sale_records_the_cash_handed_back(): void
    {
        $shift = $this->openShift($this->cashier, 1000);
        $sale = $this->ringCashSale($this->cashier, $shift['id']);

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason_code' => 'wrong_item', 'reason' => 'Wrong item'])
            ->assertOk();

        $movement = CashMovement::withoutTenancy()->where('type', 'void_refund')->first();
        $this->assertNotNull($movement, 'The cash handed back on a void must be recorded.');
        $this->assertEquals(1000, $movement->amount);
        $this->assertSame($sale['id'], $movement->source_id);
        $this->assertSame($this->cashier->id, $movement->user_id);

        // Drawer nets out: 1000 float + 1000 tendered − 1000 handed back.
        $closed = $this->close($this->cashier, 1000);
        $this->assertEquals(1000, $closed['expected_cash']);
        $this->assertEquals(0, $closed['variance']);
        // …and the void is counted, not hidden.
        $this->assertEquals(0, $closed['sales_count']);
    }

    /**
     * Yesterday's sale voided today takes cash out of TODAY's drawer. This was
     * plainly wrong before: the movement went nowhere, so today's till showed a
     * shortage for money it never held.
     */
    public function test_voiding_a_sale_from_a_closed_shift_debits_todays_drawer(): void
    {
        $yesterday = $this->openShift($this->cashier, 1000);
        $sale = $this->ringCashSale($this->cashier, $yesterday['id']);
        $this->close($this->cashier, 2000);

        // A fresh shift today.
        $this->openShift($this->cashier, 500);
        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason_code' => 'wrong_item', 'reason' => 'Customer returned next day'])
            ->assertOk();

        $closed = $this->close($this->cashier, 0);
        $this->assertEquals(1000, $closed['cash_out']);
        // 500 float − 1000 handed back = −500 expected; counting 0 is a 500 over.
        $this->assertEquals(-500, $closed['expected_cash']);
        $this->assertEquals(500, $closed['variance']);
    }

    /** A card sale voided moves no cash, so nothing hits the drawer. */
    public function test_voiding_a_card_sale_records_no_cash_movement(): void
    {
        $shift = $this->openShift($this->cashier, 1000);
        $sale = $this->actingAsUser($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'cash_session_id' => $shift['id'], 'payment_method' => 'card',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]], 'amount_paid' => 1000,
        ])->assertCreated()->json('data');

        $this->actingAsUser($this->cashier)->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason_code' => 'wrong_item'])->assertOk();

        $this->assertSame(0, CashMovement::withoutTenancy()->count());
        $this->assertEquals(1000, $this->close($this->cashier, 1000)['expected_cash']);
    }

    /** Change given back is not cash the drawer keeps. */
    public function test_a_void_returns_only_the_net_cash_the_drawer_took(): void
    {
        $shift = $this->openShift($this->cashier, 1000);
        // Pays 1500 for a 1000 item → 500 change out of the till.
        $sale = $this->ringCashSale($this->cashier, $shift['id'], 1500);

        $this->actingAsUser($this->cashier)->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason_code' => 'wrong_item'])->assertOk();

        $this->assertEquals(1000, CashMovement::withoutTenancy()->where('type', 'void_refund')->value('amount'));
    }

    // ── The X-read ──────────────────────────────────────────────────

    /**
     * A shift used to be write-only: no way to see expected cash before closing,
     * so a variance arrived as a 9pm surprise with nothing to trace it against.
     */
    public function test_the_x_read_shows_the_live_drawer_before_closing(): void
    {
        $shift = $this->openShift($this->cashier, 2000);
        $this->ringCashSale($this->cashier, $shift['id']);           // +1000
        $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/session/movements', [
            'type' => 'paid_out', 'amount' => 300, 'reason' => 'Rickshaw',
        ])->assertCreated();

        $report = $this->actingAsUser($this->cashier)->getJson('/api/v1/pos/session/report')
            ->assertOk()->json('data');

        $this->assertEquals(2700, $report['drawer']['expected_cash']);   // 2000 + 1000 − 300
        $this->assertEquals(1000, $report['drawer']['cash_sales']);
        $this->assertEquals(300, $report['drawer']['cash_out']);
        $this->assertEquals(1, $report['drawer']['sales_count']);
        $this->assertEquals(1000, $report['drawer']['tender_mix']['cash']);
        $this->assertCount(1, $report['movements']);
        $this->assertSame('Ayesha', $report['movements'][0]['user']['name']);
    }

    /** The X-read and the close must never disagree — one arithmetic, one place. */
    public function test_the_x_read_matches_what_the_close_computes(): void
    {
        $shift = $this->openShift($this->cashier, 1500);
        $this->ringCashSale($this->cashier, $shift['id'], 1200);
        $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/session/movements', [
            'type' => 'drop', 'amount' => 700,
        ])->assertCreated();

        $expectedFromRead = $this->actingAsUser($this->cashier)
            ->getJson('/api/v1/pos/session/report')->json('data.drawer.expected_cash');

        $closed = $this->close($this->cashier, 0);

        $this->assertEquals($expectedFromRead, $closed['expected_cash']);
    }

    public function test_the_x_read_needs_an_open_shift(): void
    {
        $this->actingAsUser($this->cashier)->getJson('/api/v1/pos/session/report')
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'SHIFT_NOT_OPEN');
    }

    /** A closed shift's figures are frozen, so a Z-report reprints the same numbers. */
    public function test_a_closed_shift_keeps_its_movement_totals(): void
    {
        $shift = $this->openShift($this->cashier, 1000);
        $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/session/movements', [
            'type' => 'paid_in', 'amount' => 250,
        ])->assertCreated();
        $this->close($this->cashier, 1250);

        $row = CashSession::withoutTenancy()->find($shift['id']);
        $this->assertEquals(250, $row->cash_in);
        $this->assertEquals(0, $row->cash_out);
        $this->assertEquals(1250, $row->expected_cash);
    }

    /** No back-dating into a drawer somebody already counted and signed off. */
    public function test_no_movement_can_be_added_to_a_closed_shift(): void
    {
        $this->openShift($this->cashier, 1000);
        $this->close($this->cashier, 1000);

        $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/session/movements', [
            'type' => 'paid_in', 'amount' => 100,
        ])->assertStatus(409)->assertJsonPath('meta.error_code', 'SHIFT_REQUIRED');
    }
}
