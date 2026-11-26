<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Coupon;
use App\Models\Order;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE MARKETPLACE IS WATCHED, AND ANSWERS.
 *
 *  - a customer reports a problem with an order ("order mein masla"), once,
 *    when it makes sense to; the shop is told
 *  - the platform answers it: a refund, a one-use voucher at that shop, or a
 *    reasoned no — and the customer reads the answer on the order
 *  - the platform sees every open order, the stuck ones flagged, and may
 *    cancel one that has gone wrong
 */
class TheMarketplaceIsWatchedAndAnswersTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $customer;

    private User $watcher;

    private Product $item;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true, 'latitude' => 31.52, 'longitude' => 74.35]);
        $this->shop = Tenant::factory()->create([
            'online_shop_enabled' => true, 'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'grocery', 'features' => BusinessTypes::defaultFeatures('grocery') + ['promotions' => true],
            'delivery_fee' => 100,
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->customer = User::factory()->create();
        $this->watcher = User::factory()->adminStaff([Permissions::ORDERS_OVERSEE])->create();
        $this->item = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'name' => 'Biryani', 'price' => 900, 'stock_quantity' => 50,
        ]);
    }

    private function as(User $user): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($user->createToken('t', ['access'])->plainTextToken);
    }

    private function delivered(): string
    {
        $id = $this->as($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'delivery', 'delivery_address' => 'House 1',
            'items' => [['product_id' => $this->item->id, 'quantity' => 2]],
        ])->assertCreated()->json('data.id');
        foreach (['confirmed', 'preparing', 'out_for_delivery', 'completed'] as $s) {
            $this->as($this->owner)->postJson("/api/v1/orders/{$id}/advance", ['status' => $s])->assertOk();
        }

        return $id;
    }

    private function report(string $id, array $body = ['kind' => 'missing_item', 'note' => 'No raita in the bag'])
    {
        return $this->as($this->customer)->postJson("/api/v1/customer/orders/{$id}/issue", $body);
    }

    // ── Reporting ───────────────────────────────────────────────────

    public function test_a_customer_reports_a_problem_once_and_the_shop_is_told(): void
    {
        $id = $this->delivered();
        $this->assertTrue($this->as($this->customer)->getJson("/api/v1/customer/orders/{$id}")->json('data.can_report_issue'));

        $this->report($id)->assertCreated()->assertJsonPath('data.status', 'open');
        $this->report($id)->assertStatus(422)->assertJsonPath('meta.error_code', 'ISSUE_NOT_OPEN');

        $order = $this->as($this->customer)->getJson("/api/v1/customer/orders/{$id}")->json('data');
        $this->assertSame('missing_item', $order['issue']['kind']);
        $this->assertFalse($order['can_report_issue']);
        $this->assertDatabaseHas('app_notifications', ['user_id' => $this->owner->id, 'type' => 'order.issue']);
    }

    public function test_not_on_a_fresh_order_and_not_long_after_and_never_on_somebody_elses(): void
    {
        $fresh = $this->as($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'delivery', 'delivery_address' => 'House 1',
            'items' => [['product_id' => $this->item->id, 'quantity' => 1]],
        ])->json('data.id');
        $this->report($fresh, ['kind' => 'late'])->assertStatus(422);

        // Very late is a problem in itself.
        $this->travel(50)->minutes();
        $this->report($fresh, ['kind' => 'late'])->assertCreated();

        $old = $this->delivered();
        $this->travel(80)->hours();
        $this->report($old)->assertStatus(422)->assertJsonPath('meta.error_code', 'ISSUE_NOT_OPEN');

        $mine = $this->delivered();
        $this->as(User::factory()->create())->postJson("/api/v1/customer/orders/{$mine}/issue", ['kind' => 'late'])->assertNotFound();
    }

    // ── Answering ───────────────────────────────────────────────────

    public function test_a_refund_is_recorded_and_both_sides_are_told(): void
    {
        $id = $this->delivered();
        $issue = $this->report($id)->json('data.id');

        $queue = $this->as($this->watcher)->getJson('/api/v1/admin/order-issues')->assertOk();
        $this->assertSame([$issue], array_column($queue->json('data'), 'id'));
        $this->assertSame(1, $queue->json('meta.open'));

        $this->as($this->watcher)->postJson("/api/v1/admin/order-issues/{$issue}/resolve", [
            'outcome' => 'refund', 'amount' => 5000, 'answer' => 'Sorry about the raita.',
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'ISSUE_AMOUNT_TOO_HIGH');

        $this->as($this->watcher)->postJson("/api/v1/admin/order-issues/{$issue}/resolve", [
            'outcome' => 'refund', 'amount' => 150, 'answer' => 'Sorry about the raita.',
        ])->assertOk()->assertJsonPath('data.status', 'resolved');

        $seen = $this->as($this->customer)->getJson("/api/v1/customer/orders/{$id}")->json('data.issue');
        $this->assertSame('refund', $seen['outcome']);
        $this->assertEquals(150, $seen['amount']);
        $this->assertDatabaseHas('app_notifications', ['user_id' => $this->customer->id, 'type' => 'order.issue_answered']);
        $this->assertDatabaseHas('app_notifications', ['user_id' => $this->owner->id, 'type' => 'order.issue_refund']);

        // Answered once.
        $this->as($this->watcher)->postJson("/api/v1/admin/order-issues/{$issue}/resolve", [
            'outcome' => 'none', 'answer' => 'Again?',
        ])->assertStatus(409);
    }

    public function test_a_voucher_is_a_one_use_coupon_at_that_shop_the_customer_can_spend(): void
    {
        $id = $this->delivered();
        $issue = $this->report($id)->json('data.id');

        $code = $this->as($this->watcher)->postJson("/api/v1/admin/order-issues/{$issue}/resolve", [
            'outcome' => 'voucher', 'amount' => 200, 'answer' => 'Have the next one on us.',
        ])->assertOk()->json('data.voucher_code');

        $coupon = Coupon::withoutTenancy()->where('tenant_id', $this->shop->id)->where('code', $code)->firstOrFail();
        $this->assertEquals(200, (float) $coupon->value);
        $this->assertSame(1, (int) $coupon->usage_limit);

        $next = $this->as($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'delivery', 'delivery_address' => 'House 1',
            'coupon_code' => $code, 'items' => [['product_id' => $this->item->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');
        $this->assertEquals(200, (float) $next['discount']);
    }

    public function test_a_no_needs_its_reason_and_only_the_platform_answers(): void
    {
        $issue = $this->report($this->delivered())->json('data.id');

        $this->as($this->owner)->getJson('/api/v1/admin/order-issues')->assertForbidden();
        $this->as(User::factory()->adminStaff([Permissions::BANNERS_MANAGE])->create())
            ->getJson('/api/v1/admin/order-issues')->assertForbidden();

        $this->as($this->watcher)->postJson("/api/v1/admin/order-issues/{$issue}/resolve", ['outcome' => 'none'])
            ->assertStatus(422)->assertJsonValidationErrors('answer');
        $this->as($this->watcher)->postJson("/api/v1/admin/order-issues/{$issue}/resolve", [
            'outcome' => 'none', 'answer' => 'The rider photo shows the raita in the bag.',
        ])->assertOk()->assertJsonPath('data.status', 'rejected');
    }

    // ── Watching ────────────────────────────────────────────────────

    public function test_the_live_board_flags_what_is_stuck_and_may_cancel_it(): void
    {
        $waiting = $this->as($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'delivery', 'delivery_address' => 'House 1',
            'items' => [['product_id' => $this->item->id, 'quantity' => 1]],
        ])->json('data.id');
        $done = $this->delivered();

        $board = $this->as($this->watcher)->getJson('/api/v1/admin/live-orders')->assertOk()->json('data');
        $this->assertSame([$waiting], array_column($board['orders'], 'id'), 'a completed order is not live');
        $this->assertSame([], $board['orders'][0]['flags']);

        $this->travel(6)->minutes();
        $board = $this->as($this->watcher)->getJson('/api/v1/admin/live-orders?flag=shop_slow')->json('data');
        $this->assertSame([$waiting], array_column($board['orders'], 'id'));
        $this->assertSame(1, $board['counts']['shop_slow']);

        $this->as($this->watcher)->postJson("/api/v1/admin/live-orders/{$waiting}/cancel", ['reason' => 'The shop is not answering its phone.'])
            ->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->assertSame('cancelled', Order::withoutTenancy()->findOrFail($waiting)->status->value);
        $this->assertDatabaseHas('app_notifications', ['user_id' => $this->owner->id, 'type' => 'order.cancelled_by_platform']);
        $this->assertDatabaseHas('app_notifications', ['user_id' => $this->customer->id, 'type' => 'order.cancelled']);

        $this->as($this->watcher)->postJson("/api/v1/admin/live-orders/{$done}/cancel", ['reason' => 'Too late now'])->assertStatus(409);
        $this->as($this->owner)->getJson('/api/v1/admin/live-orders')->assertForbidden();
    }

    public function test_the_boards_are_filtered_by_what_the_desk_types_and_picks(): void
    {
        $one = $this->as($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'delivery', 'delivery_address' => 'House 1',
            'items' => [['product_id' => $this->item->id, 'quantity' => 1]],
        ])->json('data');

        $board = $this->as($this->watcher)->getJson('/api/v1/admin/live-orders?search='.urlencode($one['order_number']))->json('data');
        $this->assertSame([$one['id']], array_column($board['orders'], 'id'));
        $this->assertSame([['id' => $this->shop->id, 'name' => $this->shop->business_name]], $board['shops']);
        $this->assertSame([], $this->as($this->watcher)->getJson('/api/v1/admin/live-orders?search=nobody-like-this')->json('data.orders'));
        $this->assertSame([], $this->as($this->watcher)->getJson('/api/v1/admin/live-orders?status=preparing')->json('data.orders'));
        $this->assertSame(1, $this->as($this->watcher)->getJson('/api/v1/admin/live-orders?status=preparing')->json('data.counts.open'));

        $issue = $this->report($this->delivered())->json('data.id');
        $this->assertSame([$issue], array_column($this->as($this->watcher)->getJson('/api/v1/admin/order-issues?kind=missing_item&search=raita')->json('data'), 'id'));
        $this->assertSame([], $this->as($this->watcher)->getJson('/api/v1/admin/order-issues?kind=late')->json('data'));
    }
}
