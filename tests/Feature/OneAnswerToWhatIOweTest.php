<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\PurchaseOrder;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Payable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * "WHAT DO I OWE?" HAS ONE ANSWER.
 *
 * It has had three. The first time, the supplier card counted drafts, the
 * dashboard did not, and the purchases report agreed with neither; that was
 * fixed by drawing the line at PLACED. The second time, the supplier card
 * billed what was ordered rather than what arrived, and a grocery was shown
 * Rs 45.6M of debt for goods on a truck; that was fixed by naming the column
 * once, `Payable::AMOUNT`.
 *
 * Naming the column was half the job, and the half that was left cost 7% on a
 * real shop. The RULE — how to net what arrived against what was paid — was
 * still written out three times:
 *
 *   suppliers screen   per supplier, every payment, clamped at zero
 *   dashboard          per ORDER, clamped at zero
 *   purchases report   per supplier, signed across all of them
 *
 * ── THE CASE THAT SEPARATES THEM ────────────────────────────────────
 *
 * Pay a bill in full; the van turns up short. The order is now OVERPAID, and
 * those rupees are credit with that wholesaler.
 *
 *   per order, clamped   drops the credit entirely          → too high
 *   per supplier, netted the credit comes off what is owed   → right
 *
 * On a load-test grocery with twenty-four short deliveries that was
 * Rs 4,374,232 of debt the shop did not have, on the first screen an owner
 * opens in the morning.
 *
 * This file pins the three readers to each other. It fails if any one of them
 * starts answering on its own again.
 */
class OneAnswerToWhatIOweTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Sugar 50kg', 'price' => 12000, 'cost' => 10000,
            'stock_quantity' => 0, 'track_inventory' => true,
        ]);
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function supplier(string $name): string
    {
        return $this->as()->postJson('/api/v1/suppliers', ['name' => $name])
            ->assertCreated()->json('data.id');
    }

    /** An order placed, and received SHORT — the shape that separates the rules. */
    private function orderedAndShort(string $supplierId, int $ordered, int $arrived): string
    {
        $po = $this->as()->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplierId,
            'order_date' => now()->toDateString(),
            'status' => 'ordered',
            'items' => [['product_id' => $this->product->id, 'quantity' => $ordered, 'unit_cost' => 1000]],
        ])->assertCreated()->json('data');

        $this->as()->postJson("/api/v1/purchase-orders/{$po['id']}/receive", [
            'items' => [['id' => $po['items'][0]['id'], 'quantity' => $arrived]],
        ])->assertOk();

        return $po['id'];
    }

    private function fromTheSuppliersScreen(): float
    {
        return collect($this->as()->getJson('/api/v1/suppliers')->assertOk()->json('data'))
            ->sum(fn ($s) => max(0.0, (float) $s['outstanding']));
    }

    private function fromTheDashboard(): float
    {
        return (float) $this->as()->getJson('/api/v1/dashboard')
            ->assertOk()->json('data.money_owed.payable.total');
    }

    public function test_paying_for_a_delivery_that_came_up_short_is_credit_not_nothing(): void
    {
        $s = $this->supplier('Metro Wholesale');

        // Ten sacks ordered; eight arrived; the shop hands over the full
        // 10,000 at the counter. Paid ON ACCOUNT, because naming the order is
        // now refused at the delivery's value — see the two cases at the
        // bottom of this file.
        $this->orderedAndShort($s, 10, 8);
        $this->as()->postJson("/api/v1/suppliers/{$s}/payments", [
            'amount' => 10000, 'method' => 'cash',
        ])->assertCreated();

        // Billed 8,000, paid 10,000 — the shop is 2,000 AHEAD with Metro.
        $this->assertSame(-2000.0, round((float) $this->as()->getJson("/api/v1/suppliers/{$s}")
            ->assertOk()->json('data.outstanding'), 2));

        // A second order from the same wholesaler, delivered in full.
        $this->orderedAndShort($s, 5, 5);

        // 8,000 + 5,000 billed, 10,000 paid → 3,000 owed. NOT 5,000, which is
        // what counting the second order on its own would say.
        $this->assertSame(3000.0, round($this->fromTheSuppliersScreen(), 2));
        $this->assertSame(3000.0, round($this->fromTheDashboard(), 2));
        $this->assertSame(3000.0, round(Payable::owedByShop($this->shop->id)['total'], 2));
    }

    public function test_every_screen_that_says_what_i_owe_says_the_same_number(): void
    {
        $metro = $this->supplier('Metro Wholesale');
        $chai = $this->supplier('Chai Traders');

        // Metro: a short delivery paid past its value, then another in full.
        $this->orderedAndShort($metro, 10, 6);
        $this->as()->postJson("/api/v1/suppliers/{$metro}/payments", [
            'amount' => 9000, 'method' => 'cash',
        ])->assertCreated();
        $this->orderedAndShort($metro, 4, 4);

        // Chai: plain, part paid.
        $this->orderedAndShort($chai, 7, 7);
        $this->as()->postJson("/api/v1/suppliers/{$chai}/payments", [
            'amount' => 2500, 'method' => 'cash',
        ])->assertCreated();

        $screen = round($this->fromTheSuppliersScreen(), 2);
        $dashboard = round($this->fromTheDashboard(), 2);
        $rule = round(Payable::owedByShop($this->shop->id)['total'], 2);

        $this->assertSame(
            $screen,
            $dashboard,
            "the suppliers screen says {$screen} and the dashboard says {$dashboard}",
        );
        $this->assertSame($screen, $rule);

        // And the figure itself, worked out by hand:
        //   Metro  billed 6,000 + 4,000 = 10,000, paid 9,000  → 1,000
        //   Chai   billed 7,000,              paid 2,500      → 4,500
        $this->assertSame(5500.0, $screen);
    }

    /**
     * THE CLAMP IS PER SUPPLIER AND NEVER ACROSS THEM.
     *
     * Being in advance with one wholesaler does not reduce what is owed to
     * another. A single signed total would quietly let it, and the shop would
     * underpay somebody who is still waiting.
     */
    public function test_an_advance_with_one_supplier_does_not_pay_another(): void
    {
        $metro = $this->supplier('Metro Wholesale');
        $chai = $this->supplier('Chai Traders');

        // 6,000 paid ahead to Metro, who has delivered nothing.
        $this->as()->postJson("/api/v1/suppliers/{$metro}/payments", [
            'amount' => 6000, 'method' => 'cash',
        ])->assertCreated();

        // 4,000 genuinely owed to Chai.
        $this->orderedAndShort($chai, 4, 4);

        $owed = Payable::owedByShop($this->shop->id);

        $this->assertSame(4000.0, $owed['total'], 'the advance paid off a different supplier');
        $this->assertSame(1, $owed['accounts']);
        $this->assertSame(6000.0, $owed['advances']);
        $this->assertSame(4000.0, round($this->fromTheDashboard(), 2));
    }

    /**
     * THE DENOMINATOR. Every claim above is about netting; none of them would
     * notice if the whole thing started answering zero.
     */
    public function test_a_plain_unpaid_delivery_is_simply_owed(): void
    {
        $s = $this->supplier('Metro Wholesale');
        $this->orderedAndShort($s, 9, 9);

        $this->assertSame(9000.0, round($this->fromTheSuppliersScreen(), 2));
        $this->assertSame(9000.0, round($this->fromTheDashboard(), 2));
        $this->assertSame(9000.0, round(Payable::owedByShop($this->shop->id)['total'], 2));
    }

    /** …and an order still on the truck is owed nothing by anybody. */
    public function test_an_order_that_has_not_arrived_is_on_nobody_s_total(): void
    {
        $s = $this->supplier('Metro Wholesale');
        $this->as()->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $s, 'order_date' => now()->toDateString(), 'status' => 'ordered',
            'items' => [['product_id' => $this->product->id, 'quantity' => 20, 'unit_cost' => 1000]],
        ])->assertCreated();

        $this->assertSame(0.0, round($this->fromTheSuppliersScreen(), 2));
        $this->assertSame(0.0, round($this->fromTheDashboard(), 2));
        $this->assertSame(0.0, round(Payable::owedByShop($this->shop->id)['total'], 2));
    }

    /**
     * THE PAY BUTTON MUST NOT PAY FOR WHAT DID NOT COME.
     *
     * `Payable::openOrdersFor` was pointed at the delivery when the payables
     * fault was fixed, so an order still on the truck is no longer even
     * offered to the allocator. The allocator then took up to the ORDERED
     * value out of the orders it WAS offered — so every short delivery was
     * overshot and the money went out for cartons that never arrived. On a
     * load-test grocery that was Rs 5.3M across twenty-four orders.
     *
     * Ten sacks ordered at 1,000; six arrived. The shop owes 6,000.
     */
    public function test_an_on_account_payment_stops_at_what_was_delivered(): void
    {
        $s = $this->supplier('Metro Wholesale');
        $this->orderedAndShort($s, 10, 6);

        // The shop hands over 10,000 — more than the delivery is worth. The
        // extra is an ADVANCE on the account; it must not be booked onto the
        // order as though those four sacks had come.
        $this->as()->postJson("/api/v1/suppliers/{$s}/payments", [
            'amount' => 10000, 'method' => 'cash',
        ])->assertCreated();

        $po = PurchaseOrder::withoutTenancy()
            ->where('tenant_id', $this->shop->id)->firstOrFail();

        $this->assertSame(6000.0, round((float) $po->amount_paid, 2), 'the allocator paid for undelivered goods');
        $this->assertSame('paid', $po->payment_status, 'a fully-settled short delivery still reads as partial');

        // And the account tells the truth: 6,000 billed, 10,000 handed over.
        $this->assertSame(-4000.0, round((float) $this->as()->getJson("/api/v1/suppliers/{$s}")
            ->assertOk()->json('data.outstanding'), 2));
        $this->assertSame(0.0, round($this->fromTheDashboard(), 2));
    }

    /** …and the same door, with the order named by hand. */
    public function test_paying_against_one_order_cannot_exceed_its_delivery(): void
    {
        $s = $this->supplier('Metro Wholesale');
        $po = $this->orderedAndShort($s, 10, 6);

        $this->as()->postJson("/api/v1/suppliers/{$s}/payments", [
            'amount' => 9000, 'method' => 'cash', 'purchase_order_id' => $po,
        ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'PAYMENT_EXCEEDS_DUE');

        // Nothing moved.
        $this->assertSame(6000.0, round($this->fromTheSuppliersScreen(), 2));
    }

    /**
     * THE DENOMINATOR for both: the ceiling is about the DELIVERY, not about
     * refusing payments. The right amount goes through.
     */
    public function test_paying_exactly_for_what_arrived_goes_through(): void
    {
        $s = $this->supplier('Metro Wholesale');
        $po = $this->orderedAndShort($s, 10, 6);

        $this->as()->postJson("/api/v1/suppliers/{$s}/payments", [
            'amount' => 6000, 'method' => 'cash', 'purchase_order_id' => $po,
        ])->assertCreated();

        $this->assertSame(0.0, round($this->fromTheSuppliersScreen(), 2));
        $this->assertSame(0.0, round($this->fromTheDashboard(), 2));
    }
}
