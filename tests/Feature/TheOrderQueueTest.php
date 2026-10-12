<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Rider;
use App\Models\Tenant;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE ORDER QUEUE, AND THE QUESTIONS IT COULD NOT BE ASKED.
 *
 * This screen is a queue, not a ledger, and a queue's first question is "how
 * many are waiting". There was no way to find out but to click each stage in
 * turn and read the paginator — and the shop's own dropdown could not be asked
 * for a name, a phone number, a date, whether it was a delivery, or the one
 * that actually costs money: which deliveries have nobody carrying them.
 *
 * `channel` and `open_only` were accepted by the server all along and the
 * screen sent neither.
 */
class TheOrderQueueTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->tenant = Tenant::factory()->provisioned()->create();
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
    }

    private function asOwner(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function order(array $attributes = []): Order
    {
        static $n = 0;
        $n++;

        return Order::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->tenant->id,
            'order_number' => 'ORD-'.str_pad((string) $n, 4, '0', STR_PAD_LEFT),
            'status' => 'pending',
            'fulfillment_type' => 'delivery',
            'payment_method' => 'cod',
            'payment_status' => 'unpaid',
            'customer_name' => 'Ayesha',
            'customer_phone' => '03001234567',
            'channel' => 'online',
            'subtotal' => 500,
            'delivery_fee' => 0,
            'total' => 500,
            'placed_at' => now(),
        ], $attributes));
    }

    /** @return array<int, string> the order numbers the queue returned */
    private function numbers(string $query = ''): array
    {
        return array_column(
            $this->asOwner()->getJson('/api/v1/orders?'.$query)->assertOk()->json('data'),
            'order_number',
        );
    }

    // ── How many are waiting ───────────────────────────────────────────

    public function test_every_stage_carries_its_own_count_including_the_empty_ones(): void
    {
        $this->order(['status' => 'pending']);
        $this->order(['status' => 'pending']);
        $this->order(['status' => 'preparing']);

        $counts = $this->asOwner()->getJson('/api/v1/orders')->assertOk()->json('meta.status_counts');

        $this->assertSame(2, $counts['pending']);
        $this->assertSame(1, $counts['preparing']);
        // A stage nothing is in must be a ZERO, not a missing key: no number
        // beside six that have one reads as "not counted", never as "none".
        $this->assertSame(0, $counts['cancelled']);
        $this->assertSame(3, $counts['all']);
    }

    public function test_the_counts_are_taken_without_the_stage_filter_applied(): void
    {
        $this->order(['status' => 'pending']);
        $this->order(['status' => 'preparing']);

        $counts = $this->asOwner()
            ->getJson('/api/v1/orders?status=pending')
            ->assertOk()
            ->json('meta.status_counts');

        // One row is on screen; both counts must still be right, or the chip
        // row is a set of numbers that only ever agrees with itself.
        $this->assertSame(1, $counts['pending']);
        $this->assertSame(1, $counts['preparing']);
        $this->assertSame(2, $counts['all']);
    }

    public function test_the_counts_do_narrow_with_every_other_filter(): void
    {
        $this->order(['status' => 'pending', 'channel' => 'online']);
        $this->order(['status' => 'preparing', 'channel' => 'phone']);

        $counts = $this->asOwner()
            ->getJson('/api/v1/orders?channel=phone')
            ->assertOk()
            ->json('meta.status_counts');

        // A count that ignored the channel would say one pending, and send a
        // shop looking for an order that is not in front of them.
        $this->assertSame(0, $counts['pending']);
        $this->assertSame(1, $counts['preparing']);
        $this->assertSame(1, $counts['all']);
    }

    // ── Deliveries nobody is carrying ──────────────────────────────────

    public function test_deliveries_with_no_rider_can_be_listed_and_are_counted_whatever_stage_is_showing(): void
    {
        $rider = Rider::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Bilal', 'phone' => '0300', 'is_active' => true,
        ]);

        $this->order(['status' => 'preparing', 'rider_id' => null]);              // nobody carrying it
        $this->order(['status' => 'preparing', 'rider_id' => $rider->id]);        // assigned
        $this->order(['status' => 'preparing', 'fulfillment_type' => 'pickup']);  // not a delivery
        $this->order(['status' => 'completed', 'rider_id' => null]);              // already done

        $body = $this->asOwner()->getJson('/api/v1/orders?unassigned=1')->assertOk()->json();

        $this->assertCount(1, $body['data']);
        $this->assertSame('delivery', $body['data'][0]['fulfillment_type']);
        $this->assertNull($body['data'][0]['rider_id']);

        // The warning follows the shop, not the tab: it is counted even while
        // a different stage is on screen.
        $elsewhere = $this->asOwner()->getJson('/api/v1/orders?status=completed')->assertOk()->json('meta.unassigned');
        $this->assertSame(1, $elsewhere);
    }

    public function test_a_finished_order_is_never_waiting_for_a_rider(): void
    {
        $this->order(['status' => 'completed', 'rider_id' => null]);
        $this->order(['status' => 'cancelled', 'rider_id' => null]);

        $this->assertSame([], $this->numbers('unassigned=1'));
        $this->assertSame(0, $this->asOwner()->getJson('/api/v1/orders')->json('meta.unassigned'));
    }

    // ── Finding one order ──────────────────────────────────────────────

    public function test_an_order_is_found_by_its_number_the_customer_or_their_phone(): void
    {
        $wanted = $this->order(['customer_name' => 'Farhan Malik', 'customer_phone' => '03219998877']);
        $this->order(['customer_name' => 'Somebody Else', 'customer_phone' => '03001112222']);

        $this->assertSame([$wanted->order_number], $this->numbers('search='.$wanted->order_number));
        $this->assertSame([$wanted->order_number], $this->numbers('search=Farhan'));
        $this->assertSame([$wanted->order_number], $this->numbers('search=9998877'));
        // The denominator: two orders exist, so each of those picked one of two.
        $this->assertCount(2, $this->numbers());
    }

    public function test_the_queue_can_be_narrowed_to_deliveries_or_to_pickups(): void
    {
        $delivery = $this->order(['fulfillment_type' => 'delivery']);
        $pickup = $this->order(['fulfillment_type' => 'pickup']);

        $this->assertSame([$delivery->order_number], $this->numbers('fulfillment=delivery'));
        $this->assertSame([$pickup->order_number], $this->numbers('fulfillment=pickup'));
    }

    public function test_an_order_placed_today_is_inside_a_range_that_ends_today(): void
    {
        $this->order(['placed_at' => now()->setTime(19, 15)]);

        // A `to` compared against midnight would drop every order placed
        // during the day it names — the range this screen opens with.
        $this->assertCount(1, $this->numbers('to='.now()->toDateString()));
    }

    // ── Today's, and the ones before it ────────────────────────────────

    public function test_todays_orders_and_the_past_ones_are_two_lists_that_share_nothing(): void
    {
        $now = $this->order(['placed_at' => now()]);
        $yesterday = $this->order(['placed_at' => now()->subDay()]);
        $lastWeek = $this->order(['placed_at' => now()->subDays(7), 'status' => 'completed']);

        $this->assertSame([$now->order_number], $this->numbers('when=today'));
        $this->assertSame([$yesterday->order_number, $lastWeek->order_number], $this->numbers('when=past'));
        // Neither word narrows nothing: every order is in one list or the other.
        $this->assertCount(3, $this->numbers());
    }

    public function test_today_is_the_shops_day_not_the_calendars(): void
    {
        // A restaurant that closes at two: its day turns at three.
        $this->tenant->update(['timezone' => 'Asia/Karachi', 'settings' => array_merge($this->tenant->settings ?? [], ['day_turns_at' => 3])]);

        $onTheWall = fn (string $at) => CarbonImmutable::parse($at, 'Asia/Karachi')->utc();

        // Half past one on the 12th, on the shop's wall — still the 11th's service.
        $this->travelTo($onTheWall('2026-10-12 01:30:00'));

        $tonight = $this->order(['placed_at' => $onTheWall('2026-10-11 22:10:00')]);
        $justNow = $this->order(['placed_at' => $onTheWall('2026-10-12 01:20:00')]);
        $atFour = $this->order(['placed_at' => $onTheWall('2026-10-11 04:00:00')]);
        $lastNight = $this->order(['placed_at' => $onTheWall('2026-10-11 02:00:00')]);

        // Ten at night and twenty past one are the SAME evening's service: a
        // cut at the wall's midnight would have put the first under "past"
        // while its food was still on the pass. And four in the morning is
        // after THIS shop's day turned, wherever the server's own midnight is.
        $this->assertSame(
            [$justNow->order_number, $tonight->order_number, $atFour->order_number],
            $this->numbers('when=today'),
        );
        $this->assertSame([$lastNight->order_number], $this->numbers('when=past'));
    }

    public function test_what_is_finished_can_be_asked_for_on_its_own(): void
    {
        $this->order(['status' => 'preparing']);
        $done = $this->order(['status' => 'completed', 'placed_at' => now()->subMinutes(5)]);
        $called = $this->order(['status' => 'cancelled', 'placed_at' => now()->subMinutes(9)]);
        $this->order(['status' => 'completed', 'placed_at' => now()->subDays(3)]);

        // "Finished today" — the list under the board.
        $this->assertSame([$done->order_number, $called->order_number], $this->numbers('when=today&closed_only=1'));
        // …and the two halves never overlap.
        $this->assertCount(1, $this->numbers('open_only=1'));
        $this->assertCount(3, $this->numbers('closed_only=1'));
    }

    public function test_the_queue_can_be_narrowed_to_which_door_it_came_through(): void
    {
        $web = $this->order(['channel' => 'online']);
        $this->order(['channel' => 'phone']);

        // Accepted by the server since it was written; the screen sent it for
        // the first time today.
        $this->assertSame([$web->order_number], $this->numbers('channel=online'));
    }

    public function test_only_this_shops_orders_are_ever_counted(): void
    {
        $this->order(['status' => 'pending']);

        $other = Tenant::factory()->provisioned()->create();
        Order::withoutTenancy()->create([
            'tenant_id' => $other->id, 'order_number' => 'THEIRS-1', 'status' => 'pending',
            'fulfillment_type' => 'pickup', 'payment_method' => 'cod', 'payment_status' => 'unpaid',
            'customer_name' => 'Nobody', 'channel' => 'online',
            'subtotal' => 100, 'delivery_fee' => 0, 'total' => 100, 'placed_at' => now(),
        ]);

        $body = $this->asOwner()->getJson('/api/v1/orders')->assertOk()->json();

        $this->assertCount(1, $body['data']);
        // The counts go through the same scope as the rows — a meta block that
        // skipped tenancy would leak another shop's volume as a number.
        $this->assertSame(1, $body['meta']['status_counts']['pending']);
        $this->assertSame(1, $body['meta']['status_counts']['all']);
    }
}
