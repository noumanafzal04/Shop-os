<?php

namespace Tests\Feature;

use App\Models\CommissionCharge;
use App\Models\CommissionInvoice;
use App\Models\Order;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\PlatformSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE PLATFORM'S CUT.
 *
 * A shop pays two things and they must never be confused: a PLAN for the
 * software, and COMMISSION on what the marketplace sold for it. This covers
 * the second — when it is charged, when it is not, and what a bill is allowed
 * to do after it has been sent.
 */
class CommissionTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $customer;

    private User $admin;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->shop = Tenant::factory()->create([
            'online_shop_enabled' => true, 'setup_completed' => true,
            'business_type' => 'grocery', 'features' => BusinessTypes::defaultFeatures('grocery'),
            'delivery_fee' => 100,
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->customer = User::factory()->create();
        $this->admin = User::factory()->superAdmin()->create();

        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Rice Bag', 'price' => 1000, 'cost' => 700, 'stock_quantity' => 100, 'track_inventory' => true,
        ]);
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function turnOn(float $rate = 10, string $base = 'goods'): void
    {
        $this->as($this->admin)->putJson('/api/v1/admin/commission/settings', [
            'commission_enabled' => true,
            'commission_rate' => $rate,
            'commission_base' => $base,
        ])->assertOk();
    }

    /** Place an online order and carry it all the way to completed. */
    private function sell(int $qty = 2, string $fulfillment = 'delivery'): array
    {
        $order = $this->as($this->customer)->postJson('/api/v1/customer/orders', array_filter([
            'shop_slug' => $this->shop->slug,
            'fulfillment_type' => $fulfillment,
            'delivery_address' => $fulfillment === 'delivery' ? '12 Main St' : null,
            'items' => [['product_id' => $this->product->id, 'quantity' => $qty]],
        ]))->assertCreated()->json('data');

        $steps = $fulfillment === 'delivery'
            ? ['confirmed', 'preparing', 'out_for_delivery', 'completed']
            : ['confirmed', 'preparing', 'ready', 'completed'];

        foreach ($steps as $to) {
            $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => $to])->assertOk();
        }

        return $order;
    }

    // ── When it is charged ───────────────────────────────────────────

    public function test_a_completed_online_order_earns_the_platform_its_share(): void
    {
        $this->turnOn(10);
        $order = $this->sell(qty: 2);   // 2 × 1000 = 2000 goods, + 100 delivery

        $charge = CommissionCharge::withoutTenancy()->where('order_id', $order['id'])->firstOrFail();

        // Ten per cent of the GOODS. The delivery fee is left out because it is
        // not the shop's revenue — it is the rider's — and taxing it would make
        // a shop that delivers pay more for an identical basket.
        $this->assertSame('2000.00', $charge->base_amount);
        $this->assertSame('200.00', $charge->amount);
        $this->assertSame('10.00', $charge->rate_percent);
        $this->assertSame($this->shop->id, $charge->tenant_id);
    }

    public function test_the_delivery_fee_is_included_only_when_the_platform_says_so(): void
    {
        $this->turnOn(10, base: 'total');
        $order = $this->sell(qty: 2);

        $charge = CommissionCharge::withoutTenancy()->where('order_id', $order['id'])->firstOrFail();
        $this->assertSame('2100.00', $charge->base_amount);
        $this->assertSame('210.00', $charge->amount);
    }

    public function test_nothing_is_charged_until_the_order_completes(): void
    {
        // Money that has not changed hands is not revenue. A platform that
        // bills on intent spends its week issuing credit notes.
        $this->turnOn(10);

        $order = $this->as($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'confirmed'])->assertOk();

        $this->assertSame(0, CommissionCharge::withoutTenancy()->count());

        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/cancel", ['reason' => 'Out of stock'])->assertOk();

        $this->assertSame(0, CommissionCharge::withoutTenancy()->count());
    }

    public function test_a_walk_in_sale_earns_the_platform_nothing(): void
    {
        // The line this whole feature draws: the platform charges for the
        // customers it BROUGHT. A phone order the shop wrote down itself is a
        // sale the marketplace had no part in, and billing it would be billing
        // for the software, which is what the plan is already for.
        $this->turnOn(10);

        $order = $this->as($this->owner)->postJson('/api/v1/orders', [
            'customer_name' => 'Walk-in', 'customer_phone' => '03001112222',
            'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        foreach (['confirmed', 'preparing', 'ready', 'completed'] as $to) {
            $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => $to])->assertOk();
        }

        $this->assertSame('phone', Order::withoutTenancy()->find($order['id'])->channel);
        $this->assertSame(0, CommissionCharge::withoutTenancy()->count());
    }

    public function test_commission_is_off_until_a_person_turns_it_on(): void
    {
        // A platform that starts charging the day it is installed, before
        // anybody has chosen a number, surprises its first shop.
        $this->assertFalse(PlatformSettings::get('commission_enabled'));

        $this->sell();

        $this->assertSame(0, CommissionCharge::withoutTenancy()->count());
    }

    public function test_a_rate_of_zero_charges_nothing_and_stores_nothing(): void
    {
        $this->turnOn(0);
        $this->sell();

        // Not a row of zero. A charge that costs nothing is noise on every
        // screen that lists what a shop owes.
        $this->assertSame(0, CommissionCharge::withoutTenancy()->count());
    }

    public function test_a_shops_own_rate_beats_the_platforms(): void
    {
        $this->turnOn(10);

        $this->as($this->admin)->putJson("/api/v1/admin/commission/{$this->shop->id}/rate", [
            'commission_rate' => 4.5,
        ])->assertOk()->assertJsonPath('data.effective_rate', 4.5);

        $order = $this->sell(qty: 2);
        $charge = CommissionCharge::withoutTenancy()->where('order_id', $order['id'])->firstOrFail();
        $this->assertSame('90.00', $charge->amount);

        // Null is not zero: it means "follow the platform" for ever after.
        $this->as($this->admin)->putJson("/api/v1/admin/commission/{$this->shop->id}/rate", [
            'commission_rate' => null,
        ])->assertOk()->assertJsonPath('data.effective_rate', 10);
    }

    public function test_a_rate_typed_wrong_cannot_bill_the_whole_platform(): void
    {
        $this->as($this->admin)->putJson('/api/v1/admin/commission/settings', ['commission_rate' => 500])
            ->assertStatus(422)->assertJsonValidationErrors('commission_rate');

        $this->as($this->admin)->putJson("/api/v1/admin/commission/{$this->shop->id}/rate", ['commission_rate' => -1])
            ->assertStatus(422)->assertJsonValidationErrors('commission_rate');
    }

    // ── The rate is a snapshot ───────────────────────────────────────

    public function test_changing_the_rate_never_re_prices_a_sale_already_made(): void
    {
        // The most important rule in the file. A bill that silently re-prices
        // itself is a bill nobody can check.
        $this->turnOn(10);
        $order = $this->sell(qty: 2);

        $this->as($this->admin)->putJson('/api/v1/admin/commission/settings', ['commission_rate' => 25])->assertOk();

        $charge = CommissionCharge::withoutTenancy()->where('order_id', $order['id'])->firstOrFail();
        $this->assertSame('10.00', $charge->rate_percent);
        $this->assertSame('200.00', $charge->amount);

        // …and the next sale pays the new one.
        $next = $this->sell(qty: 2);
        $this->assertSame(
            '500.00',
            CommissionCharge::withoutTenancy()->where('order_id', $next['id'])->firstOrFail()->amount,
        );
    }

    public function test_one_order_is_charged_once_however_often_completion_is_retried(): void
    {
        $this->turnOn(10);
        $order = $this->sell();

        // Completing again is refused by the status flow, and the charge would
        // be the thing that doubled if it were not keyed to the order.
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'completed'])
            ->assertStatus(409);

        $this->assertSame(1, CommissionCharge::withoutTenancy()->where('order_id', $order['id'])->count());
    }

    // ── Billing for it ───────────────────────────────────────────────

    public function test_an_invoice_bundles_a_period_and_the_charges_leave_the_outstanding_list(): void
    {
        $this->turnOn(10);
        $this->sell(qty: 2);
        $this->sell(qty: 3);

        $this->as($this->admin)->getJson('/api/v1/admin/commission')
            ->assertOk()
            ->assertJsonPath('data.total_outstanding', 500)
            ->assertJsonPath('data.shops.0.outstanding_orders', 2);

        $invoice = $this->as($this->admin)->postJson("/api/v1/admin/commission/{$this->shop->id}/invoices", [
            'from' => now()->subDay()->toDateString(),
            'to' => now()->toDateString(),
        ])->assertCreated()
            ->assertJsonPath('data.number', 'COM-00001')
            ->assertJsonPath('data.orders_count', 2)
            ->assertJsonPath('data.status', 'unpaid')
            ->json('data');

        $this->assertSame('500.00', $invoice['amount']);

        // Billed is not outstanding.
        $this->as($this->admin)->getJson('/api/v1/admin/commission')
            ->assertOk()->assertJsonPath('data.total_outstanding', 0);

        // And a second invoice for the same window has nothing left to bill —
        // which is the guard against billing one order twice.
        $this->as($this->admin)->postJson("/api/v1/admin/commission/{$this->shop->id}/invoices", [
            'from' => now()->subDay()->toDateString(), 'to' => now()->toDateString(),
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'COMMISSION_NOTHING_TO_BILL');
    }

    public function test_an_invoice_is_paid_once(): void
    {
        $this->turnOn(10);
        $this->sell();

        $id = $this->as($this->admin)->postJson("/api/v1/admin/commission/{$this->shop->id}/invoices", [
            'from' => now()->subDay()->toDateString(), 'to' => now()->toDateString(),
        ])->assertCreated()->json('data.id');

        $this->as($this->admin)->postJson("/api/v1/admin/commission-invoices/{$id}/paid", ['note' => 'Bank transfer'])
            ->assertOk()->assertJsonPath('data.status', 'paid');

        $this->as($this->admin)->postJson("/api/v1/admin/commission-invoices/{$id}/paid")
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'COMMISSION_ALREADY_PAID');
    }

    public function test_withdrawing_an_invoice_puts_its_charges_back(): void
    {
        $this->turnOn(10);
        $this->sell(qty: 2);

        $id = $this->as($this->admin)->postJson("/api/v1/admin/commission/{$this->shop->id}/invoices", [
            'from' => now()->subDay()->toDateString(), 'to' => now()->toDateString(),
        ])->assertCreated()->json('data.id');

        // A reason is required: an invoice withdrawn without one is a number a
        // shop saw and can never be told the fate of.
        $this->as($this->admin)->postJson("/api/v1/admin/commission-invoices/{$id}/void")
            ->assertStatus(422)->assertJsonValidationErrors('reason');

        $this->as($this->admin)->postJson("/api/v1/admin/commission-invoices/{$id}/void", [
            'reason' => 'Raised against the wrong month.',
        ])->assertOk()->assertJsonPath('data.status', 'void');

        // Void, not deleted — and the money is owed again.
        $this->assertSame(1, CommissionInvoice::withoutTenancy()->count());
        $this->as($this->admin)->getJson('/api/v1/admin/commission')
            ->assertOk()->assertJsonPath('data.total_outstanding', 200);
    }

    public function test_a_paid_invoice_cannot_be_withdrawn(): void
    {
        $this->turnOn(10);
        $this->sell();

        $id = $this->as($this->admin)->postJson("/api/v1/admin/commission/{$this->shop->id}/invoices", [
            'from' => now()->subDay()->toDateString(), 'to' => now()->toDateString(),
        ])->assertCreated()->json('data.id');

        $this->as($this->admin)->postJson("/api/v1/admin/commission-invoices/{$id}/paid")->assertOk();

        $this->as($this->admin)->postJson("/api/v1/admin/commission-invoices/{$id}/void", ['reason' => 'oops'])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'COMMISSION_ALREADY_PAID');
    }

    public function test_a_charge_can_be_written_off_but_not_after_it_is_billed(): void
    {
        $this->turnOn(10);
        $order = $this->sell(qty: 2);
        $charge = CommissionCharge::withoutTenancy()->where('order_id', $order['id'])->firstOrFail();

        $this->as($this->admin)->postJson("/api/v1/admin/commission-charges/{$charge->id}/waive")
            ->assertStatus(422)->assertJsonValidationErrors('reason');

        $this->as($this->admin)->postJson("/api/v1/admin/commission-charges/{$charge->id}/waive", [
            'reason' => 'Order was refunded in cash.',
        ])->assertOk();

        $this->as($this->admin)->getJson('/api/v1/admin/commission')
            ->assertOk()->assertJsonPath('data.total_outstanding', 0);

        // A written-off charge is not billable, so there is nothing to invoice.
        $this->as($this->admin)->postJson("/api/v1/admin/commission/{$this->shop->id}/invoices", [
            'from' => now()->subDay()->toDateString(), 'to' => now()->toDateString(),
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'COMMISSION_NOTHING_TO_BILL');
    }

    // ── Who may see and do this ──────────────────────────────────────

    public function test_the_platforms_cut_needs_its_own_permission(): void
    {
        // Not `billing.view`, which reads the PLAN ledger. Setting this rate
        // changes what every shop on the marketplace is charged, and whoever
        // may READ the revenue figures is not automatically whoever may DECIDE
        // them.
        $reader = User::factory()->adminStaff(['billing.view'])->create();
        $this->as($reader)->getJson('/api/v1/admin/commission')->assertForbidden();

        $setter = User::factory()->adminStaff(['commission.manage'])->create();
        $this->as($setter)->getJson('/api/v1/admin/commission')->assertOk();
    }

    public function test_a_shop_owner_can_check_the_bill_but_not_change_it(): void
    {
        $this->turnOn(10);
        $this->sell(qty: 2);

        $this->as($this->owner)->getJson('/api/v1/commission')
            ->assertOk()
            ->assertJsonPath('data.rate', 10)
            // The shop follows the platform's number rather than one of its
            // own, and is told which — a shop asking "why am I paying this"
            // deserves the answer.
            ->assertJsonPath('data.rate_is_yours', false)
            ->assertJsonPath('data.outstanding.amount', 200)
            ->assertJsonCount(1, 'data.charges');

        // Read-only from over here.
        $this->as($this->owner)->putJson('/api/v1/admin/commission/settings', ['commission_rate' => 0])
            ->assertForbidden();
    }

    public function test_one_shop_never_sees_another_shops_bill(): void
    {
        $this->turnOn(10);
        $this->sell(qty: 2);

        $otherOwner = User::factory()->shopOwner(Tenant::factory()->provisioned()->create())->create();

        $this->as($otherOwner)->getJson('/api/v1/commission')
            ->assertOk()
            ->assertJsonPath('data.outstanding.amount', 0)
            ->assertJsonCount(0, 'data.charges');
    }
}
