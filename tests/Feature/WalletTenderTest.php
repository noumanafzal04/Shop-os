<?php

namespace Tests\Feature;

use App\Enums\PaymentMethod;
use App\Models\Branch;
use App\Models\Customer;
use App\Models\Product;
use App\Models\Register;
use App\Models\SalePayment;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\OfflinePolicy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A mobile wallet is a tender of its own — JazzCash, Easypaisa, Raast.
 *
 * ── What was actually wrong ─────────────────────────────────────────────
 *
 * There was nowhere to put it. A cashier taking Easypaisa rang it as `other`,
 * or as `bank_transfer` — whose POS label had already drifted to "Bank /
 * wallet", which is the shape of a gap somebody worked around rather than
 * reported. Either way the shop closed its day with one figure covering two
 * things that reconcile against two different apps, and the question they
 * actually ask — "how much came through the wallet today?" — had no answer.
 *
 * ── The one claim worth a test ──────────────────────────────────────────
 *
 * A wallet is NOT cash. No rupees entered the drawer, so the expectation must
 * not move by a single paisa. Get that wrong and every wallet sale reads as a
 * shortage at closing, landing on the cashier as a variance they cannot
 * explain — which is worse than having no wallet tender at all.
 */
class WalletTenderTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

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
        $this->cashier = User::factory()->tenantStaff($this->tenant, [
            'sales.manage', 'customers.manage',
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

    private function openShift(float $float = 5000): array
    {
        return $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/session/open', [
            'opening_float' => $float, 'register_id' => $this->lane->id,
        ])->assertCreated()->json('data');
    }

    private function report(): array
    {
        return $this->actingAsUser($this->cashier)
            ->getJson('/api/v1/pos/session/report')->assertOk()->json('data');
    }

    // ── The tender exists, and keeps its own name ───────────────────

    public function test_a_wallet_sale_is_recorded_as_a_wallet_and_not_folded_into_other(): void
    {
        $shift = $this->openShift();

        $sale = $this->actingAsUser($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'cash_session_id' => $shift['id'],
            'payment_method' => 'wallet', 'amount_paid' => 1000,
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertSame('wallet', $sale['payment_method']);

        // The breakdown row too — the drawer, the Z-read and the receipt all
        // read sale_payments, not the sale's summary column.
        $this->assertSame('wallet', SalePayment::withoutTenancy()
            ->where('sale_id', $sale['id'])->value('method'));
    }

    /**
     * The money claim: a wallet payment leaves the drawer exactly where it was.
     */
    public function test_a_wallet_sale_does_not_move_the_drawer(): void
    {
        $shift = $this->openShift(5000);

        $this->actingAsUser($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'cash_session_id' => $shift['id'],
            'payment_method' => 'wallet', 'amount_paid' => 1000,
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated();

        $drawer = $this->report()['drawer'];

        // Still just the opening float. Not 6000.
        $this->assertEquals(5000, $drawer['expected_cash']);
        $this->assertEquals(0, $drawer['cash_sales']);
        // …while the sale itself is a sale, counted and totalled like any other.
        $this->assertEquals(1, $drawer['sales_count']);
        $this->assertEquals(1000, $drawer['sales_total']);
        // And it is visible AS a wallet, which is the whole point.
        $this->assertEquals(1000, $drawer['tender_mix']['wallet']);
        $this->assertArrayNotHasKey('cash', $drawer['tender_mix']);
    }

    /**
     * Half on the phone, half in notes — the common Pakistani counter.
     *
     * Only the notes belong to the drawer. A split that let the wallet slice
     * through would overstate the till by exactly the wallet amount.
     */
    public function test_a_split_counts_only_the_cash_slice_toward_the_drawer(): void
    {
        $shift = $this->openShift(2000);

        $this->actingAsUser($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'cash_session_id' => $shift['id'],
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
            'payments' => [
                ['method' => 'cash', 'amount' => 400],
                ['method' => 'wallet', 'amount' => 600, 'reference' => 'JC-88213'],
            ],
        ])->assertCreated()->assertJsonPath('data.payment_method', 'split');

        $drawer = $this->report()['drawer'];

        $this->assertEquals(2400, $drawer['expected_cash']);   // 2000 + 400, not + 1000
        $this->assertEquals(400, $drawer['tender_mix']['cash']);
        $this->assertEquals(600, $drawer['tender_mix']['wallet']);

        // The wallet's own transaction id survives — it is what the shop
        // matches against the wallet app when a figure disagrees.
        $this->assertSame('JC-88213', SalePayment::withoutTenancy()
            ->where('method', 'wallet')->value('reference'));
    }

    /**
     * Closing the drawer: the cashier declares the wallet total separately and
     * gets its own variance, instead of one "Bank / wallet" box for two apps.
     */
    public function test_the_wallet_is_declared_and_varied_on_its_own_at_close(): void
    {
        $shift = $this->openShift(1000);

        $this->actingAsUser($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'cash_session_id' => $shift['id'],
            'payment_method' => 'wallet', 'amount_paid' => 1000,
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated();

        $closed = $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/session/close', [
            'counted_cash' => 1000,
            // The wallet app showed 950 — 50 short, and the shop now knows
            // WHICH tender is short rather than only that something is.
            'declared_tenders' => ['wallet' => 950],
        ])->assertOk()->json('data');

        $this->assertEquals(0, $closed['variance']);                       // the cash is fine
        $this->assertEquals(-50, $closed['tender_variances']['wallet']);
    }

    // ── Offline ─────────────────────────────────────────────────────

    /**
     * A wallet settles at the counter and shares nothing, so it is offline-safe
     * for exactly the reason a card is: the confirmation arrives on the
     * cashier's own phone, over their own data, not over the shop's line.
     */
    public function test_a_wallet_sale_rung_offline_is_not_flagged(): void
    {
        $this->assertSame([], OfflinePolicy::violations(['payment_method' => 'wallet']));

        // And the refusal is still there for the tender that really is shared,
        // or the assertion above would pass on a policy that allows everything.
        $this->assertNotSame([], OfflinePolicy::violations(['payment_method' => 'credit']));
    }

    // ── The other doors money crosses ───────────────────────────────

    /**
     * Widening the till without widening the rest would be half a rule: a
     * customer who pays their khata by Easypaisa hits a different endpoint.
     */
    public function test_a_khata_repayment_can_be_taken_by_wallet(): void
    {
        $customer = Customer::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Bilal', 'phone' => '03001234567',
            'credit_balance' => 5000,
        ]);

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/customers/{$customer->id}/payments", [
                'amount' => 2000, 'method' => 'wallet',
            ])->assertCreated();

        $this->assertEquals(3000, $customer->fresh()->credit_balance);
    }

    /**
     * The list every request rule now reads. Written as an assertion because
     * the point of moving it here was that it stops being nine lists.
     */
    public function test_the_counter_tender_list_carries_the_wallet_and_still_refuses_the_shared_ones(): void
    {
        $this->assertContains('wallet', PaymentMethod::counter());
        $this->assertContains('wallet', PaymentMethod::counterOrCredit());

        foreach (['credit', 'deposit', 'trade_in', 'split'] as $shared) {
            $this->assertNotContains($shared, PaymentMethod::counter(), "{$shared} is not a counter tender");
        }
        $this->assertContains('credit', PaymentMethod::counterOrCredit());
    }
}
