<?php

namespace Tests\Feature;

use App\Jobs\SendChannelNotification;
use App\Models\AppNotification;
use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Services\NotificationService;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class NotificationsTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'online_shop_enabled' => true,
            'setup_completed' => true,
            'city_id' => $city->id,
            'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->customer = User::factory()->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('test-device', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    // ── Core service ────────────────────────────────────────────────

    public function test_notify_stores_and_queues_channel_delivery(): void
    {
        Queue::fake();

        app(NotificationService::class)->notify(
            $this->owner, 'test.event', 'Hello', 'World',
        );

        $this->assertSame(1, AppNotification::query()->count());
        Queue::assertPushed(SendChannelNotification::class, 1);
    }

    public function test_dedupe_key_prevents_duplicate_notifications(): void
    {
        $service = app(NotificationService::class);

        $first = $service->notify($this->owner, 'test.event', 'Hello', 'World', [], 'evt-1');
        $second = $service->notify($this->owner, 'test.event', 'Hello', 'World', [], 'evt-1');

        $this->assertNotNull($first);
        $this->assertNull($second); // retry never double-notifies
        $this->assertSame(1, AppNotification::query()->count());
    }

    // ── Event wiring ────────────────────────────────────────────────

    private function makeReservation(): array
    {
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product',
            'name' => 'Sneaker', 'price' => 5000, 'stock_quantity' => 5,
        ]);

        $reservation = $this->actingAsUser($this->customer)
            ->postJson('/api/v1/customer/reservations', [
                'shop_slug' => $this->shop->slug,
                'product_id' => $product->id,
                'quantity' => 1,
            ])->assertCreated()->json('data');

        return [$product, $reservation];
    }

    public function test_reservation_lifecycle_notifies_the_right_people(): void
    {
        [, $reservation] = $this->makeReservation();

        // Owner got "new reservation".
        $ownerNote = AppNotification::query()->where('user_id', $this->owner->id)->first();
        $this->assertSame('reservation.created', $ownerNote->type);

        // Accept → customer notified.
        $this->actingAsUser($this->owner)->postJson("/api/v1/reservations/{$reservation['id']}/accept");
        $customerNote = AppNotification::query()
            ->where('user_id', $this->customer->id)
            ->where('type', 'reservation.accepted')
            ->first();
        $this->assertNotNull($customerNote);
        $this->assertStringContainsString('Sneaker', $customerNote->body);
    }

    public function test_rejection_notifies_customer_with_reason(): void
    {
        [, $reservation] = $this->makeReservation();

        $this->actingAsUser($this->owner)->postJson(
            "/api/v1/reservations/{$reservation['id']}/reject",
            ['reason' => 'Out of season'],
        );

        $note = AppNotification::query()
            ->where('user_id', $this->customer->id)
            ->where('type', 'reservation.rejected')
            ->first();
        $this->assertStringContainsString('Out of season', $note->body);
    }

    public function test_low_stock_alerts_once_on_crossing_and_rearms_after_restock(): void
    {
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product',
            'name' => 'Widget', 'price' => 100, 'stock_quantity' => 10, 'low_stock_threshold' => 5,
        ]);

        $lowStockCount = fn () => AppNotification::query()
            ->where('user_id', $this->owner->id)
            ->where('type', 'stock.low')
            ->count();

        // 10 → 4 crosses the threshold → ONE alert.
        $this->actingAsUser($this->owner)->postJson('/api/v1/inventory/adjust', [
            'product_id' => $product->id, 'type' => 'out', 'quantity' => 6,
        ]);
        $this->assertSame(1, $lowStockCount());

        // Further drop below threshold → still one (deduped).
        $this->actingAsUser($this->owner)->postJson('/api/v1/inventory/adjust', [
            'product_id' => $product->id, 'type' => 'out', 'quantity' => 2,
        ]);
        $this->assertSame(1, $lowStockCount());

        // Restock above threshold, then drop again → re-armed, second alert.
        $this->actingAsUser($this->owner)->postJson('/api/v1/inventory/adjust', [
            'product_id' => $product->id, 'type' => 'in', 'quantity' => 10,
        ]);
        $this->actingAsUser($this->owner)->postJson('/api/v1/inventory/adjust', [
            'product_id' => $product->id, 'type' => 'out', 'quantity' => 8,
        ]);
        $this->assertSame(2, $lowStockCount());
    }

    // ── Endpoints ───────────────────────────────────────────────────

    public function test_list_shows_own_only_with_unread_count(): void
    {
        $service = app(NotificationService::class);
        $service->notify($this->owner, 'a', 'A', 'a');
        $service->notify($this->owner, 'b', 'B', 'b');
        $service->notify($this->customer, 'c', 'C', 'c'); // someone else's

        $response = $this->actingAsUser($this->owner)->getJson('/api/v1/notifications')
            ->assertOk();

        $this->assertCount(2, $response->json('data'));
        $this->assertSame(2, $response->json('meta.unread_count'));
    }

    public function test_mark_read_and_read_all(): void
    {
        $service = app(NotificationService::class);
        $first = $service->notify($this->owner, 'a', 'A', 'a');
        $service->notify($this->owner, 'b', 'B', 'b');

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/notifications/{$first->id}/read")
            ->assertOk();

        $this->assertSame(1, $this->actingAsUser($this->owner)
            ->getJson('/api/v1/notifications')->json('meta.unread_count'));

        $this->actingAsUser($this->owner)->postJson('/api/v1/notifications/read-all')->assertOk();

        $this->assertSame(0, $this->actingAsUser($this->owner)
            ->getJson('/api/v1/notifications')->json('meta.unread_count'));
    }

    public function test_cannot_read_others_notifications(): void
    {
        $note = app(NotificationService::class)->notify($this->owner, 'a', 'A', 'a');

        $this->actingAsUser($this->customer)
            ->postJson("/api/v1/notifications/{$note->id}/read")
            ->assertStatus(404);
    }
}
