<?php

namespace Tests\Feature;

use App\Actions\Purchase\CreatePurchaseOrderAction;
use App\Actions\Purchase\ReceivePurchaseOrderAction;
use App\Models\Branch;
use App\Models\City;
use App\Models\Product;
use App\Models\PurchaseOrder;
use App\Models\Supplier;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BranchContext;
use App\Support\BusinessTypes;
use App\Support\Payable;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A SHOP OWES FOR WHAT ARRIVED, NOT FOR WHAT IT ASKED FOR.
 *
 * `Payable` drew one line — a draft is a shopping list, a placed order is a
 * bill — and that line is right. It never answered the other half: how much
 * of a placed order is a bill when half of it is still on the truck.
 *
 * Every reader took `purchase_orders.total`, which is what was ORDERED and
 * never moves. An order placed and not delivered was billed in full; an order
 * delivered short was billed for the part that never came. On one load-test
 * shop that was Rs 45.6M of debt against goods never received, on a true
 * payable of Rs 57.6M.
 *
 * And it was not only a wrong number on a card. `openOrdersFor` treats any
 * order with `amount_paid < total` as open and the payment action allocates
 * oldest-first into exactly those — so paying down "what I owe" handed a
 * wholesaler money for stock the shop had not seen.
 */
class OweForWhatArrivedTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private Supplier $supplier;

    private Product $rice;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Kasur', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        User::factory()->shopOwner($this->shop)->create();
        app(TenantContext::class)->set($this->shop);
        app(BranchContext::class)->set(
            Branch::withoutTenancy()->where('tenant_id', $this->shop->id)->where('is_default', true)->first()
        );

        $this->supplier = Supplier::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Akbari Traders', 'is_active' => true,
        ]);
        $this->rice = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'name' => 'Basmati 50kg',
            'price' => 1000, 'cost' => 100, 'track_inventory' => true, 'is_active' => true,
        ]);
    }

    protected function tearDown(): void
    {
        app(BranchContext::class)->set(null);
        app(TenantContext::class)->clear();
        parent::tearDown();
    }

    /** 100 bags ordered at Rs 100 = Rs 10,000 on the order. */
    private function order(): PurchaseOrder
    {
        return app(CreatePurchaseOrderAction::class)->execute([
            'supplier_id' => $this->supplier->id,
            'order_date' => now()->subDay()->toDateString(),
            'status' => 'ordered',
            'items' => [['product_id' => $this->rice->id, 'quantity' => 100, 'unit_cost' => 100]],
        ]);
    }

    private function owed(): float
    {
        return (float) Supplier::withOutstanding()->findOrFail($this->supplier->id)->outstanding;
    }

    public function test_an_order_still_on_the_truck_is_owed_nothing(): void
    {
        $po = $this->order();

        $this->assertSame(10000.0, (float) $po->total, 'the ORDER is still Rs 10,000');
        $this->assertSame(0.0, $this->owed(), 'nothing has arrived, so nothing is owed');
    }

    public function test_a_short_delivery_is_billed_short(): void
    {
        $po = $this->order()->load('items');

        // Sixty of the hundred bags turn up.
        app(ReceivePurchaseOrderAction::class)->execute($po, [
            $po->items->first()->id => ['quantity' => 60],
        ]);

        $this->assertSame(10000.0, (float) $po->fresh()->total, 'the order document does not change');
        $this->assertSame(6000.0, $this->owed(), '60 bags at Rs 100 is the bill');
    }

    public function test_a_full_delivery_is_billed_in_full(): void
    {
        // The denominator. Without it, "bill nothing, ever" would pass the two
        // cases above.
        $po = $this->order()->load('items');

        app(ReceivePurchaseOrderAction::class)->execute($po, [
            $po->items->first()->id => ['quantity' => 100],
        ]);

        $this->assertSame(10000.0, $this->owed());
    }

    public function test_a_payment_cannot_be_allocated_to_an_undelivered_order(): void
    {
        // The money half. `openOrdersFor` decides where a payment lands, and
        // an order nothing has arrived against must not absorb any of it.
        $this->order();

        $this->assertSame(
            0,
            Payable::openOrdersFor($this->supplier->id)->count(),
            'an undelivered order is not an open bill',
        );
    }

    public function test_a_short_order_is_open_only_for_what_came(): void
    {
        $po = $this->order()->load('items');
        app(ReceivePurchaseOrderAction::class)->execute($po, [
            $po->items->first()->id => ['quantity' => 60],
        ]);

        $open = Payable::openOrdersFor($this->supplier->id)->get();

        $this->assertCount(1, $open);
        $this->assertSame(6000.0, (float) $open->first()->received_total);
    }
}
