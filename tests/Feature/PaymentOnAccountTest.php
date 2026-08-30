<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\CashMovement;
use App\Models\City;
use App\Models\Product;
use App\Models\Register;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * PAYING A SUPPLIER THE WAY THE SCREEN ACTUALLY PAYS ONE.
 *
 * The Suppliers list has a Pay button. It sends an amount and a method and
 * NOTHING ELSE — there is no order picker on it and never has been. The
 * server accepted every one of those payments, filed the row, took the cash
 * out of the drawer, and left `purchase_orders.amount_paid` untouched. Since
 * a supplier's Outstanding is computed as (orders − amount_paid), the number
 * on the row did not move. The shopkeeper pays, sees the same red figure,
 * and pays again.
 *
 * Every payment test that existed passed `purchase_order_id`. The API had a
 * door the UI does not use, and that door was the only one under test.
 */
class PaymentOnAccountTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Rice 5kg', 'price' => 2400, 'cost' => 1800, 'stock_quantity' => 0, 'track_inventory' => true,
        ]);
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function supplier(string $name = 'Acme Traders'): string
    {
        return $this->as($this->owner)->postJson('/api/v1/suppliers', ['name' => $name])
            ->assertCreated()->json('data.id');
    }

    private function po(string $supplierId, float $cost, int $qty = 1, string $status = 'ordered', string $date = '2026-07-01'): array
    {
        return $this->as($this->owner)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplierId, 'order_date' => $date, 'status' => $status,
            'items' => [['product_id' => $this->product->id, 'quantity' => $qty, 'unit_cost' => $cost]],
        ])->assertCreated()->json('data');
    }

    /** What the Pay button sends: an amount and a method. */
    private function pay(string $supplierId, float $amount, array $extra = []): TestResponse
    {
        return $this->as($this->owner)->postJson("/api/v1/suppliers/{$supplierId}/payments", [
            'amount' => $amount, 'method' => 'cash', ...$extra,
        ]);
    }

    /** A drawer for the owner, so cash out of the till has somewhere to land. */
    private function openShift(): void
    {
        $main = Branch::withoutTenancy()
            ->where('tenant_id', $this->shop->id)->where('is_default', true)->firstOrFail();
        $lane = Register::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'branch_id' => $main->id, 'name' => 'Lane 1', 'is_active' => true,
        ]);

        $this->as($this->owner)->postJson('/api/v1/pos/session/open', [
            'opening_float' => 20000, 'register_id' => $lane->id,
        ])->assertCreated();
    }

    private function outstanding(string $supplierId): float
    {
        return (float) $this->as($this->owner)->getJson("/api/v1/suppliers/{$supplierId}")
            ->assertOk()->json('data.outstanding');
    }

    // ── The bug ─────────────────────────────────────────────────────

    public function test_a_payment_with_no_order_named_reduces_what_is_owed(): void
    {
        $supplier = $this->supplier();
        $this->po($supplier, cost: 36000);

        $this->assertSame(36000.0, $this->outstanding($supplier), 'the debt did not start where the test thinks it did');

        $this->pay($supplier, 15000)->assertCreated();

        $this->assertSame(
            21000.0,
            $this->outstanding($supplier),
            'money left the shop and the supplier still shows the full amount owed',
        );
    }

    public function test_it_settles_the_oldest_order_first(): void
    {
        $supplier = $this->supplier();
        $june = $this->po($supplier, cost: 5000, date: '2026-06-01');
        $july = $this->po($supplier, cost: 8000, date: '2026-07-01');

        // Enough to clear June and put 2,000 against July.
        $this->pay($supplier, 7000)->assertCreated();

        $juneFresh = $this->as($this->owner)->getJson("/api/v1/purchase-orders/{$june['id']}")->json('data');
        $julyFresh = $this->as($this->owner)->getJson("/api/v1/purchase-orders/{$july['id']}")->json('data');

        $this->assertEquals(5000, $juneFresh['amount_paid'], 'the oldest order was not settled first');
        $this->assertSame('paid', $juneFresh['payment_status']);
        $this->assertEquals(2000, $julyFresh['amount_paid'], 'the remainder did not carry to the next order');
        $this->assertSame('partial', $julyFresh['payment_status']);

        $this->assertSame(6000.0, $this->outstanding($supplier));
    }

    /**
     * Paying against a NAMED order is still held to that order's due — the
     * caller quoted a figure that can be checked, and being over it is a typo.
     */
    public function test_paying_more_than_one_order_is_due_is_refused(): void
    {
        $supplier = $this->supplier();
        $po = $this->po($supplier, cost: 5000);

        $this->pay($supplier, 5001, ['purchase_order_id' => $po['id']])->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'PAYMENT_EXCEEDS_DUE');

        // …and nothing was filed on the way to being refused. A refusal that
        // still books the row is the worse half of the original bug.
        $this->assertSame(5000.0, $this->outstanding($supplier));
        $this->assertCount(0, $this->as($this->owner)
            ->getJson("/api/v1/suppliers/{$supplier}")->json('data.payments'));

        // Denominator: a rupee under is accepted.
        $this->pay($supplier, 4999, ['purchase_order_id' => $po['id']])->assertCreated();
        $this->assertSame(1.0, $this->outstanding($supplier));
    }

    /**
     * Cash on delivery with no paperwork — the commonest payment a small shop
     * makes. It used to vanish: the money left, the account did not move.
     */
    public function test_paying_a_supplier_with_no_orders_is_money_ahead_not_money_lost(): void
    {
        $supplier = $this->supplier();

        $this->pay($supplier, 3500)->assertCreated();

        $card = $this->as($this->owner)->getJson("/api/v1/suppliers/{$supplier}")->json('data');
        $this->assertSame(-3500.0, (float) $card['outstanding'], 'cash left the shop and the account never moved');
        $this->assertSame(3500.0, (float) $card['advance']);

        // And the next order it arrives against is settled by it.
        $this->po($supplier, cost: 5000);
        $this->assertSame(1500.0, $this->outstanding($supplier));
    }

    public function test_an_order_cannot_be_paid_before_it_is_placed(): void
    {
        $supplier = $this->supplier();
        $draft = $this->po($supplier, cost: 5000, status: 'draft');

        $this->pay($supplier, 1000, ['purchase_order_id' => $draft['id']])->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'PO_NOT_PAYABLE');
    }

    /** The denominator: the door that WAS under test still opens. */
    public function test_naming_an_order_still_pays_that_order(): void
    {
        $supplier = $this->supplier();
        $june = $this->po($supplier, cost: 5000, date: '2026-06-01');
        $july = $this->po($supplier, cost: 8000, date: '2026-07-01');

        // Deliberately the NEWER order. If the named id were ignored and the
        // oldest-first path ran anyway, June would move and this would fail.
        $this->pay($supplier, 3000, ['purchase_order_id' => $july['id']])->assertCreated();

        $this->assertEquals(3000, $this->as($this->owner)
            ->getJson("/api/v1/purchase-orders/{$july['id']}")->json('data.amount_paid'));
        $this->assertEquals(0, $this->as($this->owner)
            ->getJson("/api/v1/purchase-orders/{$june['id']}")->json('data.amount_paid'),
            'a payment aimed at one order landed on another');
    }

    // ── A draft is not a bill ───────────────────────────────────────

    public function test_a_draft_order_is_not_a_debt(): void
    {
        $supplier = $this->supplier();
        $this->po($supplier, cost: 9000, status: 'draft');

        $this->assertSame(
            0.0,
            $this->outstanding($supplier),
            'a shopping list nobody has sent was billed to the shop as a debt',
        );

        // Denominator: place it and it becomes one.
        $this->po($supplier, cost: 4000, status: 'ordered');
        $this->assertSame(4000.0, $this->outstanding($supplier));
    }

    public function test_the_supplier_card_and_the_dashboard_agree(): void
    {
        $supplier = $this->supplier();
        $this->po($supplier, cost: 10000);
        $this->po($supplier, cost: 6000, status: 'draft');
        $this->pay($supplier, 4000)->assertCreated();

        $dash = $this->as($this->owner)->getJson('/api/v1/dashboard')->assertOk()
            ->json('data.money_owed.payable.total');

        $this->assertSame(6000.0, $this->outstanding($supplier));
        $this->assertEquals(6000, $dash, 'the supplier card and the dashboard disagree about the same debt');
    }

    /**
     * Money paid against an order that was later cancelled does not evaporate.
     *
     * The old sum dropped the cancelled order's total AND its amount_paid, so
     * a shop that had paid Rs 5,000 towards a delivery it then cancelled saw
     * the account go back to zero — the five thousand simply left the record.
     * It is now what it really is: money the supplier is holding.
     */
    public function test_paying_for_an_order_that_is_then_cancelled_leaves_the_money_visible(): void
    {
        $supplier = $this->supplier();
        $po = $this->po($supplier, cost: 12000);

        $this->pay($supplier, 5000, ['purchase_order_id' => $po['id']])->assertCreated();
        $this->assertSame(7000.0, $this->outstanding($supplier));

        $this->as($this->owner)->postJson("/api/v1/purchase-orders/{$po['id']}/cancel", [
            'reason_code' => 'wrong_item', 'reason' => 'Sent the wrong brand',
        ])->assertOk();

        $card = $this->as($this->owner)->getJson("/api/v1/suppliers/{$supplier}")->json('data');
        $this->assertSame(-5000.0, (float) $card['outstanding'], 'the money paid on a cancelled order vanished');
        $this->assertSame(5000.0, (float) $card['advance']);
    }

    // ── The drawer ──────────────────────────────────────────────────

    public function test_one_cash_payment_leaves_the_drawer_once(): void
    {
        $supplier = $this->supplier();
        $this->po($supplier, cost: 5000, date: '2026-06-01');
        $this->po($supplier, cost: 5000, date: '2026-07-01');

        // Spans two orders — it must still be ONE movement out of the till.
        $this->openShift();
        $this->pay($supplier, 7000)->assertCreated();

        $movements = CashMovement::withoutTenancy()
            ->where('tenant_id', $this->shop->id)->where('type', 'supplier_out')->get();

        $this->assertCount(1, $movements, 'a payment split over two orders left the drawer twice');
        $this->assertEquals(7000, $movements->first()->amount);
    }
}
