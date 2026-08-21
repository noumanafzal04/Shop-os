<?php

namespace Tests\Feature;

use App\Jobs\SendChannelNotification;
use App\Models\DeviceToken;
use App\Models\Tenant;
use App\Models\User;
use App\Services\NotificationService;
use App\Support\DeepLinks;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class PushNotificationTest extends TestCase
{
    use RefreshDatabase;

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    // ── Device registration ─────────────────────────────────────────

    public function test_user_registers_and_deregisters_a_device(): void
    {
        $user = User::factory()->create(); // customer, no tenant

        $this->actingAsUser($user)->postJson('/api/v1/devices', [
            'token' => 'fcm-token-abc', 'platform' => 'android',
        ])->assertOk();

        $this->assertDatabaseHas('device_tokens', ['token' => 'fcm-token-abc', 'user_id' => $user->id]);

        $this->actingAsUser($user)->deleteJson('/api/v1/devices', ['token' => 'fcm-token-abc'])->assertOk();
        $this->assertDatabaseMissing('device_tokens', ['token' => 'fcm-token-abc']);
    }

    public function test_registering_an_existing_token_repoints_it_to_the_new_user(): void
    {
        $a = User::factory()->create();
        $b = User::factory()->create();

        $this->actingAsUser($a)->postJson('/api/v1/devices', ['token' => 'shared-device'])->assertOk();
        $this->actingAsUser($b)->postJson('/api/v1/devices', ['token' => 'shared-device'])->assertOk();

        $this->assertSame(1, DeviceToken::query()->where('token', 'shared-device')->count());
        $this->assertSame($b->id, DeviceToken::query()->where('token', 'shared-device')->first()->user_id);
    }

    public function test_device_registration_requires_auth(): void
    {
        $this->postJson('/api/v1/devices', ['token' => 'x'])->assertUnauthorized();
    }

    // ── Deep-link routing ───────────────────────────────────────────

    public function test_deep_link_routes(): void
    {
        $this->assertSame('orders/o1', DeepLinks::routeFor('order.placed', ['order_id' => 'o1']));
        $this->assertSame('orders/o2', DeepLinks::routeFor('order.completed', ['order_id' => 'o2']));
        $this->assertSame('inventory', DeepLinks::routeFor('stock.low', ['product_id' => 'p1']));
        $this->assertSame('reservations/r1', DeepLinks::routeFor('reservation.created', ['reservation_id' => 'r1']));
        $this->assertNull(DeepLinks::routeFor('something.else', []));
    }

    /**
     * EVERY type this system emits gets asked the question.
     *
     * The old test named four types and passed. It could not have failed for the
     * two expiry alerts, because it did not know they existed — a check with no
     * denominator, green against a real gap for as long as the gap existed.
     *
     * So this drives the list from the emitters instead. Add a producer without
     * a destination and this is what says so.
     */
    public function test_every_notification_type_this_app_emits_resolves_to_a_screen(): void
    {
        $emitted = [
            'announcement' => ['announcement_id' => 'a1'],
            'order.placed' => ['order_id' => 'o1'],
            'order.confirmed' => ['order_id' => 'o1'],
            'order.rider_assigned' => ['order_id' => 'o1'],
            'order.cancelled' => ['order_id' => 'o1'],
            'order.completed' => ['order_id' => 'o1'],
            'reservation.created' => ['reservation_id' => 'r1'],
            'reservation.accepted' => ['reservation_id' => 'r1'],
            'reservation.rejected' => ['reservation_id' => 'r1'],
            'stock.low' => ['product_id' => 'p1'],
            'stock.expiry.approaching' => ['batch_id' => 'b1'],
            'stock.expiry.expired' => ['batch_id' => 'b1'],
        ];

        $homeless = [];
        foreach ($emitted as $type => $data) {
            if (DeepLinks::routeFor($type, $data) === null) {
                $homeless[] = $type;
            }
        }

        $this->assertSame([], $homeless, 'these notification types are sent with nowhere to go: '.implode(', ', $homeless));
    }

    /** Both expiry stages land on Disposals, which is what raises them says. */
    public function test_an_expiring_lot_links_to_disposals(): void
    {
        $this->assertSame('disposals', DeepLinks::routeFor('stock.expiry.expired', ['batch_id' => 'b1']));
        $this->assertSame('disposals', DeepLinks::routeFor('stock.expiry.approaching', ['batch_id' => 'b1']));

        // And the neighbour it used to be confused with keeps its own screen:
        // low stock is a reorder decision, not a disposal one.
        $this->assertSame('inventory', DeepLinks::routeFor('stock.low', ['product_id' => 'p1']));
    }

    public function test_notification_stores_deep_link_in_data(): void
    {
        $user = User::factory()->create();
        $n = app(NotificationService::class)->notify(
            $user, 'order.completed', 'Done', 'Your order is complete', ['order_id' => 'abc'],
        );
        $this->assertSame('orders/abc', $n->data['link']);
    }

    // ── FCM delivery ────────────────────────────────────────────────

    public function test_push_sends_to_fcm_with_registered_tokens_and_link(): void
    {
        config(['services.fcm.key' => 'test-server-key', 'services.fcm.endpoint' => 'https://fcm.test/send']);
        Http::fake(['fcm.test/*' => Http::response(['results' => [['message_id' => '1']]], 200)]);

        $user = User::factory()->create();
        DeviceToken::query()->create(['user_id' => $user->id, 'token' => 'dev-1', 'platform' => 'android']);

        $notification = app(NotificationService::class)->notify(
            $user, 'order.completed', 'Order ready', 'Come collect', ['order_id' => 'xyz'],
        );

        // Run the queued push job synchronously.
        app()->call([new SendChannelNotification($notification->id, 'push'), 'handle']);

        Http::assertSent(function ($request) {
            return str_contains($request->url(), 'fcm.test')
                && in_array('dev-1', $request['registration_ids'], true)
                && $request['data']['link'] === 'orders/xyz'
                && $request['data']['type'] === 'order.completed';
        });
    }

    public function test_push_prunes_tokens_fcm_reports_invalid(): void
    {
        config(['services.fcm.key' => 'k', 'services.fcm.endpoint' => 'https://fcm.test/send']);
        Http::fake(['fcm.test/*' => Http::response(['results' => [['error' => 'NotRegistered']]], 200)]);

        $user = User::factory()->create();
        DeviceToken::query()->create(['user_id' => $user->id, 'token' => 'dead-token', 'platform' => 'ios']);

        $n = app(NotificationService::class)->notify($user, 'order.completed', 'x', 'y', ['order_id' => '1']);
        app()->call([new SendChannelNotification($n->id, 'push'), 'handle']);

        $this->assertDatabaseMissing('device_tokens', ['token' => 'dead-token']);
    }

    public function test_push_without_devices_makes_no_http_call(): void
    {
        config(['services.fcm.key' => 'k', 'services.fcm.endpoint' => 'https://fcm.test/send']);
        Http::fake();

        $user = User::factory()->create();
        $n = app(NotificationService::class)->notify($user, 'order.completed', 'x', 'y', ['order_id' => '1']);
        app()->call([new SendChannelNotification($n->id, 'push'), 'handle']);

        Http::assertNothingSent();
    }
}
