<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Order;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE RIDER WITH NO APP CAME BACK WITH THE CASH AND NOWHERE TO PUT IT.
 *
 * `OrderService::assignRider()` states the design in its own docblock:
 *
 *     Model A: no rider app — the shop drives the status; the rider name
 *     shows on the customer's tracking.
 *
 * That is the ordinary Pakistani shop. The boy on the bike is a name and a
 * phone number on the riders screen; he has no phone app, no profile, no
 * login. The shop assigns him, he goes, he comes back with the notes, and
 * somebody presses Settle.
 *
 * Except Settle refused, always, for exactly those riders.
 *
 * ── Why ─────────────────────────────────────────────────────────────────
 *
 * `RiderService::settle()` gathers `delivered_at IS NOT NULL`, and so does
 * the `cash_in_hand` figure on the riders screen. Exactly one line in the
 * whole codebase ever wrote `delivered_at`, and it is inside
 * `RiderService::deliver()` — the rider-APP endpoint.
 *
 * So a shop that drives the status itself, which is the documented design,
 * finished every delivery through `advance → completed`, left `delivered_at`
 * null on every one of them, and watched the riders screen report Rs 0 in a
 * pocket that had the day's takings in it. Settle then said "This rider is
 * not holding any cash for you."
 *
 * Every existing test of this money walked the rider-app path, which is why a
 * green suite never saw it. The denominator is the point: four tests of the
 * settlement, four riders with the app, nought of the shape most shops run.
 *
 * ── The rule ────────────────────────────────────────────────────────────
 *
 * Completing a DELIVERY order is the goods reaching the customer, whoever
 * pressed the button. A pickup is not — nobody carried it, and nobody is
 * holding cash for it.
 */
class TheRiderWithNoAppTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $product;

    private string $cardId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create([
            'name' => 'Lahore', 'is_active' => true, 'latitude' => 31.52, 'longitude' => 74.35,
        ]);

        $this->shop = Tenant::factory()->create([
            'online_shop_enabled' => true, 'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'grocery', 'features' => BusinessTypes::defaultFeatures('grocery'),
            'delivery_fee' => 100, 'latitude' => 31.52, 'longitude' => 74.35,
        ]);

        $this->owner = User::factory()->shopOwner($this->shop)->create();

        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Rice Bag', 'price' => 2000, 'cost' => 1500,
            'stock_quantity' => 50, 'track_inventory' => true,
        ]);

        // A NAME AND A PHONE NUMBER. No application, no documents, no review,
        // no login — the whole of what most shops know about their rider.
        $this->cardId = $this->as($this->owner)
            ->postJson('/api/v1/riders', ['name' => 'Bilal', 'phone' => '03001234567'])
            ->assertCreated()->json('data.id');
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** A phone order, out with the boy on the bike, finished by the shop. */
    private function deliveredByTheShop(string $payment = 'cod'): Order
    {
        $order = $this->as($this->owner)->postJson('/api/v1/orders', [
            'channel' => 'phone',
            'customer_name' => 'Ayesha',
            'customer_phone' => '03211234567',
            'fulfillment_type' => 'delivery',
            'delivery_address' => 'House 12, Johar Town, Lahore',
            'payment_method' => $payment,
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->as($this->owner)
            ->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'confirmed'])->assertOk();
        $this->as($this->owner)
            ->postJson("/api/v1/orders/{$order['id']}/assign-rider", ['rider_id' => $this->cardId])->assertOk();

        // A delivery never sits on `ready` — the counter is not where it is
        // collected from, so the state machine goes straight out of the door.
        foreach (['preparing', 'out_for_delivery', 'completed'] as $step) {
            $this->as($this->owner)
                ->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => $step])->assertOk();
        }

        return Order::withoutTenancy()->findOrFail($order['id']);
    }

    private function cashOnTheScreen(): ?float
    {
        foreach ($this->as($this->owner)->getJson('/api/v1/riders')->assertOk()->json('data') as $row) {
            if ($row['id'] === $this->cardId) {
                return (float) $row['cash_in_hand'];
            }
        }

        return null;
    }

    public function test_an_order_the_shop_finished_itself_counts_as_delivered(): void
    {
        $order = $this->deliveredByTheShop();

        $this->assertNotNull(
            $order->delivered_at,
            'The shop drove this order to completed with a rider on it. If that is not "delivered", '
            .'nothing a phone-call rider ever carries is.',
        );
    }

    public function test_the_screen_shows_the_cash_in_the_boys_pocket(): void
    {
        $order = $this->deliveredByTheShop();

        $this->assertSame(
            round((float) $order->total, 2),
            $this->cashOnTheScreen(),
            'The rider has the notes. The riders screen is the only place that says so.',
        );
    }

    public function test_settle_takes_the_money_the_rider_brought_back(): void
    {
        $order = $this->deliveredByTheShop();

        $settlement = $this->as($this->owner)
            ->postJson("/api/v1/riders/{$this->cardId}/settle", ['note' => 'Evening handover'])
            ->assertCreated()->json('data');

        $this->assertSame(round((float) $order->total, 2), round((float) $settlement['cash_collected'], 2));
        $this->assertSame(1, (int) $settlement['orders_count']);
        $this->assertSame(0.0, $this->cashOnTheScreen(), 'Settled money is no longer in a pocket.');
    }

    /**
     * A PREPAID ORDER IS NOT CASH IN A POCKET.
     *
     * The rider carried the goods, not the money. Counting it would hand the
     * shop a settlement figure for notes nobody is holding, and the rider
     * would be asked for money they were never given.
     */
    public function test_a_prepaid_delivery_puts_nothing_in_the_pocket(): void
    {
        $this->deliveredByTheShop(payment: 'paid');

        $this->assertSame(0.0, $this->cashOnTheScreen());

        $this->as($this->owner)
            ->postJson("/api/v1/riders/{$this->cardId}/settle")
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'RIDER_NOTHING_TO_SETTLE');
    }

    /**
     * NOBODY CARRIED A COLLECTION.
     *
     * A pickup is completed at the counter by the customer walking in. There
     * is no delivery to stamp, and stamping one would put a collection on a
     * rider's statement.
     */
    public function test_a_pickup_is_never_marked_delivered(): void
    {
        $order = $this->as($this->owner)->postJson('/api/v1/orders', [
            'channel' => 'phone',
            'customer_name' => 'Ayesha',
            'customer_phone' => '03211234567',
            'fulfillment_type' => 'pickup',
            'payment_method' => 'cod',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        foreach (['confirmed', 'preparing', 'ready', 'completed'] as $step) {
            $this->as($this->owner)
                ->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => $step])->assertOk();
        }

        $this->assertNull(Order::withoutTenancy()->findOrFail($order['id'])->delivered_at);
    }
}
