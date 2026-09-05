<?php

namespace Tests\Feature;

use App\Enums\OrderStatus;
use App\Enums\RiderStatus;
use App\Jobs\SendChannelNotification;
use App\Models\DeviceToken;
use App\Models\Tenant;
use App\Models\User;
use App\Services\NotificationService;
use App\Support\DeepLinks;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Cache;
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
     * EVERY type this system emits gets asked the question — AND THE LIST IS
     * READ OFF THE CODE.
     *
     * The version before this one had the same title and a list somebody
     * typed. It named twelve types and passed, and it could not have failed
     * for a thirteenth, because it did not know about one. It went green for
     * a whole feature's worth of rider notifications that had nowhere to go.
     *
     * A check with no denominator is not a check. So this greps the emitters
     * for the type strings they actually pass, expands the two that are
     * INTERPOLATED from an enum — `order.{status}` and `rider.{status}` — and
     * asks every one of them.
     */
    public function test_every_notification_type_this_app_emits_resolves_to_a_screen(): void
    {
        $emitted = $this->typesTheCodeEmits();

        // The denominator, stated. If the scan stops matching, this fails
        // rather than passing by finding nothing to check.
        $this->assertGreaterThanOrEqual(18, count($emitted), 'the emitter scan found suspiciously little');
        $this->assertContains('order.rider_assigned', $emitted);
        $this->assertContains('rider.approved', $emitted);
        $this->assertContains('stock.expiry.expired', $emitted);

        $sample = [
            'order_id' => 'o1', 'reservation_id' => 'r1', 'product_id' => 'p1',
            'batch_id' => 'b1', 'announcement_id' => 'a1', 'rider_profile_id' => 'rp1',
        ];

        $homeless = [];
        foreach ($emitted as $type) {
            if (DeepLinks::routeFor($type, $sample) === null) {
                $homeless[] = $type;
            }
        }

        $this->assertSame([], $homeless,
            'these notification types are sent with nowhere to go: '.implode(', ', $homeless));
    }

    /**
     * The type strings this codebase actually passes to `notify()`.
     *
     * @return list<string>
     */
    private function typesTheCodeEmits(): array
    {
        $types = [];

        foreach ($this->phpFilesUnder(app_path()) as $file) {
            $src = file_get_contents($file);

            // Literals: 'order.completed', 'stock.low', …
            preg_match_all(
                "/'((?:order|reservation|review|stock|subscription|rider)\.[a-z0-9_.]+)'/",
                $src, $m,
            );
            foreach ($m[1] as $type) {
                // `stock.expiry.` is a PREFIX used to build two real types.
                if (str_ends_with($type, '.')) {
                    $types[] = $type.'approaching';
                    $types[] = $type.'expired';

                    continue;
                }
                $types[] = $type;
            }

            // Interpolated from an enum: "order.{$to->value}" and
            // "rider.{$status->value}" — the two that a literal grep cannot
            // see, and between them nine real types.
            if (preg_match('/"order\.\{\$/', $src) === 1) {
                foreach (OrderStatus::cases() as $case) {
                    $types[] = 'order.'.$case->value;
                }
            }
            if (preg_match('/"rider\.\{\$/', $src) === 1) {
                foreach (RiderStatus::cases() as $case) {
                    $types[] = 'rider.'.$case->value;
                }
            }
        }

        // Raised by the announcement broadcaster with a bare word.
        $types[] = 'announcement';

        sort($types);

        return array_values(array_unique($types));
    }

    /** @return list<string> */
    private function phpFilesUnder(string $dir): array
    {
        $out = [];
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir)) as $file) {
            if ($file->isFile() && $file->getExtension() === 'php') {
                $out[] = $file->getPathname();
            }
        }

        return $out;
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

    // ── FCM delivery, over HTTP v1 ──────────────────────────────────
    //
    // The legacy API these tests used to describe is switched off. Everything
    // below is the v1 shape: an OAuth2 bearer minted from a service account,
    // one request per device, and per-request failure reporting.

    /**
     * A throwaway service account with a REAL key pair.
     *
     * Generated rather than pasted, because the sender signs a JWT with it —
     * a fake string would fail at `openssl_pkey_get_private` and the test would
     * be exercising the error path while claiming to exercise the happy one.
     */
    private function serviceAccount(): string
    {
        $key = openssl_pkey_new([
            'private_key_bits' => 2048,
            'private_key_type' => OPENSSL_KEYTYPE_RSA,
        ]);
        openssl_pkey_export($key, $pem);

        return json_encode([
            'type' => 'service_account',
            'project_id' => 'cartze-test',
            'client_email' => 'push@cartze-test.iam.gserviceaccount.com',
            'private_key' => $pem,
        ]);
    }

    private function withFcm(): void
    {
        config(['services.fcm.credentials' => $this->serviceAccount()]);
        Cache::forget('fcm.v1.access_token');
    }

    /**
     * Raise a notification and let it deliver.
     *
     * `notify()` dispatches `SendChannelNotification` itself, and the test
     * queue is `sync` — so the job has already run by the time this returns.
     * The previous version ALSO ran it by hand afterwards, which sent every
     * push twice. Nothing caught it because the legacy API took all of a
     * user's tokens in one request, so "twice" and "once" produced the same
     * single call; the moment v1 made it one request per device, the double
     * showed up as six sends to three phones.
     */
    private function pushTo(User $user, array $data = ['order_id' => 'xyz']): void
    {
        app(NotificationService::class)->notify(
            $user, 'order.completed', 'Order ready', 'Come collect', $data,
        );
    }

    public function test_push_mints_a_token_then_sends_to_the_v1_endpoint(): void
    {
        $this->withFcm();
        Http::fake([
            'oauth2.googleapis.com/*' => Http::response(['access_token' => 'ya29.fake', 'expires_in' => 3600]),
            'fcm.googleapis.com/*' => Http::response(['name' => 'projects/cartze-test/messages/1']),
        ]);

        $user = User::factory()->create();
        DeviceToken::query()->create(['user_id' => $user->id, 'token' => 'dev-1', 'platform' => 'android']);

        $this->pushTo($user);

        // The grant: a signed assertion, not a static server key.
        Http::assertSent(fn ($r) => str_contains($r->url(), 'oauth2.googleapis.com')
            && $r['grant_type'] === 'urn:ietf:params:oauth:grant-type:jwt-bearer'
            && str_contains((string) $r['assertion'], '.'));

        // The send: the project's own v1 URL, a bearer, ONE token, and the
        // deep link the tap needs.
        Http::assertSent(function ($r) {
            return $r->url() === 'https://fcm.googleapis.com/v1/projects/cartze-test/messages:send'
                && $r->hasHeader('Authorization', 'Bearer ya29.fake')
                && $r['message']['token'] === 'dev-1'
                && $r['message']['notification']['title'] === 'Order ready'
                && $r['message']['data']['link'] === 'orders/xyz'
                && $r['message']['data']['type'] === 'order.completed'
                // Android 8+ drops a notification whose channel it does not
                // know, silently. Naming it is not decoration.
                && $r['message']['android']['notification']['channel_id'] === 'default';
        });
    }

    public function test_the_access_token_is_minted_once_and_reused(): void
    {
        // Two network calls per push, forever, is what caching this avoids —
        // and a token that outlives its cache entry is a 401 on a notification
        // nobody sees fail, which is why the window is shorter than the hour
        // Google grants.
        $this->withFcm();
        Http::fake([
            'oauth2.googleapis.com/*' => Http::response(['access_token' => 'ya29.fake', 'expires_in' => 3600]),
            'fcm.googleapis.com/*' => Http::response(['name' => 'ok']),
        ]);

        $user = User::factory()->create();
        DeviceToken::query()->create(['user_id' => $user->id, 'token' => 'dev-1', 'platform' => 'android']);

        $this->pushTo($user, ['order_id' => 'a']);
        $this->pushTo($user, ['order_id' => 'b']);

        $mints = collect(Http::recorded())
            ->filter(fn ($pair) => str_contains($pair[0]->url(), 'oauth2.googleapis.com'))
            ->count();

        $this->assertSame(1, $mints);
    }

    public function test_a_user_with_three_devices_gets_three_sends(): void
    {
        // v1 has no `registration_ids` array. One request per device is the
        // API, and a loop that quietly sent to only the first would look
        // identical from here without this.
        $this->withFcm();
        Http::fake([
            'oauth2.googleapis.com/*' => Http::response(['access_token' => 'ya29.fake']),
            'fcm.googleapis.com/*' => Http::response(['name' => 'ok']),
        ]);

        $user = User::factory()->create();
        foreach (['a', 'b', 'c'] as $t) {
            DeviceToken::query()->create(['user_id' => $user->id, 'token' => $t, 'platform' => 'android']);
        }

        $this->pushTo($user);

        $sent = collect(Http::recorded())
            ->filter(fn ($pair) => str_contains($pair[0]->url(), 'messages:send'))
            ->map(fn ($pair) => $pair[0]['message']['token'])
            // `filter()` keeps the original keys, and a keyed array is not
            // equal to a list even when the values match.
            ->values()
            ->all();

        $this->assertEqualsCanonicalizing(['a', 'b', 'c'], $sent);
    }

    public function test_push_prunes_a_token_google_says_is_gone(): void
    {
        $this->withFcm();
        Http::fake([
            'oauth2.googleapis.com/*' => Http::response(['access_token' => 'ya29.fake']),
            'fcm.googleapis.com/*' => Http::response([
                'error' => [
                    'status' => 'NOT_FOUND',
                    'details' => [['errorCode' => 'UNREGISTERED']],
                ],
            ], 404),
        ]);

        $user = User::factory()->create();
        DeviceToken::query()->create(['user_id' => $user->id, 'token' => 'dead-token', 'platform' => 'ios']);

        $this->pushTo($user);

        $this->assertDatabaseMissing('device_tokens', ['token' => 'dead-token']);
    }

    public function test_a_server_error_does_not_cost_somebody_their_notifications(): void
    {
        // Only UNREGISTERED and its siblings mean "this device will never
        // receive again". A 500, a rate limit or a network blip must leave the
        // token exactly where it is — the old positional pruning deleted the
        // WRONG token whenever the results array was shorter than the request.
        $this->withFcm();
        Http::fake([
            'oauth2.googleapis.com/*' => Http::response(['access_token' => 'ya29.fake']),
            'fcm.googleapis.com/*' => Http::response(['error' => ['status' => 'INTERNAL']], 500),
        ]);

        $user = User::factory()->create();
        DeviceToken::query()->create(['user_id' => $user->id, 'token' => 'still-good', 'platform' => 'android']);

        $this->pushTo($user);

        $this->assertDatabaseHas('device_tokens', ['token' => 'still-good']);
    }

    public function test_without_a_service_account_nothing_is_sent(): void
    {
        // Dev mode. There is no legacy endpoint left to fall back to, so the
        // only honest behaviour is to log and stop — the in-app notification
        // is already stored either way.
        config(['services.fcm.credentials' => null]);
        Http::fake();

        $user = User::factory()->create();
        DeviceToken::query()->create(['user_id' => $user->id, 'token' => 'dev-1', 'platform' => 'android']);

        $this->pushTo($user);

        Http::assertNothingSent();
    }

    public function test_a_broken_service_account_is_refused_rather_than_half_used(): void
    {
        config(['services.fcm.credentials' => '{"project_id":"x"}']);
        Cache::forget('fcm.v1.access_token');
        Http::fake();

        $user = User::factory()->create();
        DeviceToken::query()->create(['user_id' => $user->id, 'token' => 'dev-1', 'platform' => 'android']);

        $this->pushTo($user);

        Http::assertNothingSent();
        $this->assertDatabaseHas('device_tokens', ['token' => 'dev-1']);
    }

    public function test_push_without_devices_makes_no_http_call(): void
    {
        $this->withFcm();
        Http::fake();

        $user = User::factory()->create();
        $this->pushTo($user);

        Http::assertNothingSent();
    }
}
