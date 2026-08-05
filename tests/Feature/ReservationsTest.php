<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\Reservation;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class ReservationsTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $customer;

    private Product $product;

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
            'features' => BusinessTypes::defaultFeatures('retail'), // reservations: true
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->customer = User::factory()->create(); // customer role
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product',
            'name' => 'Limited Sneaker', 'price' => 5000, 'cost' => 3000, 'stock_quantity' => 3,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('test-device', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function reserve(int $quantity = 1): array
    {
        return $this->actingAsUser($this->customer)->postJson('/api/v1/customer/reservations', [
            'shop_slug' => $this->shop->slug,
            'product_id' => $this->product->id,
            'quantity' => $quantity,
        ])->assertCreated()->json('data');
    }

    // ── Creation ────────────────────────────────────────────────────

    public function test_customer_reserves_with_price_snapshot(): void
    {
        $reservation = $this->reserve();

        $this->assertSame('pending', $reservation['status']);
        $this->assertSame('Limited Sneaker', $reservation['product_name']);
        $this->assertSame('5000.00', $reservation['unit_price']);
        // Pending does NOT hold stock yet.
        $this->assertEquals(3, $this->product->fresh()->stock_quantity);
    }

    public function test_shop_without_reservations_feature_rejects(): void
    {
        // Wholesale: marketplace stays on, reservations off — hits the
        // RESERVATIONS_DISABLED guard, not the visibility 404.
        $this->shop->forceFill([
            'features' => BusinessTypes::defaultFeatures('wholesale'),
        ])->save();

        $this->actingAsUser($this->customer)->postJson('/api/v1/customer/reservations', [
            'shop_slug' => $this->shop->slug,
            'product_id' => $this->product->id,
            'quantity' => 1,
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'RESERVATIONS_DISABLED');
    }

    public function test_cannot_reserve_more_than_available(): void
    {
        $this->actingAsUser($this->customer)->postJson('/api/v1/customer/reservations', [
            'shop_slug' => $this->shop->slug,
            'product_id' => $this->product->id,
            'quantity' => 5, // only 3 in stock
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'INSUFFICIENT_STOCK');
    }

    // ── Acceptance & stock hold ─────────────────────────────────────

    public function test_accept_locks_stock_through_inventory(): void
    {
        $reservation = $this->reserve(2);

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/reservations/{$reservation['id']}/accept")
            ->assertOk()
            ->assertJsonPath('data.status', 'accepted');

        $this->assertEquals(1, $this->product->fresh()->stock_quantity);

        $movement = StockMovement::withoutTenancy()->first();
        $this->assertSame('reservation', $movement->reference_type);
        $this->assertEquals(-2, $movement->quantity_change);
    }

    public function test_last_item_race_first_accept_wins(): void
    {
        $this->product->forceFill(['stock_quantity' => 1])->save();

        // Two customers reserve the final item — both pending is fine.
        $first = $this->reserve();
        $other = User::factory()->create();
        $second = $this->actingAsUser($other)->postJson('/api/v1/customer/reservations', [
            'shop_slug' => $this->shop->slug,
            'product_id' => $this->product->id,
            'quantity' => 1,
        ])->json('data');

        // First acceptance wins the stock…
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/reservations/{$first['id']}/accept")
            ->assertOk();

        // …second acceptance fails cleanly and STAYS pending.
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/reservations/{$second['id']}/accept")
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'INSUFFICIENT_STOCK');

        $this->assertSame('pending', Reservation::withoutTenancy()->find($second['id'])->status->value);
    }

    public function test_product_sold_before_acceptance(): void
    {
        $reservation = $this->reserve(3);

        // Walk-in customer buys everything first.
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $this->product->id, 'quantity' => 3]],
            'payment_method' => 'cash', 'amount_paid' => 15000,
        ])->assertCreated();

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/reservations/{$reservation['id']}/accept")
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'INSUFFICIENT_STOCK');
    }

    public function test_accept_after_expiry_blocked(): void
    {
        $reservation = $this->reserve();
        Reservation::withoutTenancy()->whereKey($reservation['id'])
            ->update(['expires_at' => now()->subHour()]);

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/reservations/{$reservation['id']}/accept")
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'RESERVATION_EXPIRED');
    }

    // ── Reject / cancel / expire release stock ──────────────────────

    public function test_reject_accepted_reservation_restores_stock(): void
    {
        $reservation = $this->reserve(2);
        $this->actingAsUser($this->owner)->postJson("/api/v1/reservations/{$reservation['id']}/accept");
        $this->assertEquals(1, $this->product->fresh()->stock_quantity);

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/reservations/{$reservation['id']}/reject", ['reason' => 'Damaged stock'])
            ->assertOk()
            ->assertJsonPath('data.status', 'rejected');

        $this->assertEquals(3, $this->product->fresh()->stock_quantity);
    }

    public function test_customer_cancels_accepted_reservation_stock_released(): void
    {
        $reservation = $this->reserve(1);
        $this->actingAsUser($this->owner)->postJson("/api/v1/reservations/{$reservation['id']}/accept");
        $this->assertEquals(2, $this->product->fresh()->stock_quantity);

        $this->actingAsUser($this->customer)
            ->postJson("/api/v1/customer/reservations/{$reservation['id']}/cancel")
            ->assertOk()
            ->assertJsonPath('data.status', 'cancelled');

        $this->assertEquals(3, $this->product->fresh()->stock_quantity);
    }

    public function test_no_show_expiry_releases_stock_exactly_once(): void
    {
        $reservation = $this->reserve(2);
        $this->actingAsUser($this->owner)->postJson("/api/v1/reservations/{$reservation['id']}/accept");
        Reservation::withoutTenancy()->whereKey($reservation['id'])
            ->update(['expires_at' => now()->subMinute()]);

        $this->artisan('reservations:expire')->assertSuccessful();

        $this->assertSame('expired', Reservation::withoutTenancy()->find($reservation['id'])->status->value);
        $this->assertEquals(3, $this->product->fresh()->stock_quantity);

        // Running the sweeper again never double-releases.
        $this->artisan('reservations:expire')->assertSuccessful();
        $this->assertEquals(3, $this->product->fresh()->stock_quantity);
    }

    // ── Completion → sale ───────────────────────────────────────────

    public function test_complete_converts_to_sale_at_reserved_price(): void
    {
        $reservation = $this->reserve(2);
        $this->actingAsUser($this->owner)->postJson("/api/v1/reservations/{$reservation['id']}/accept");

        $response = $this->actingAsUser($this->owner)
            ->postJson("/api/v1/reservations/{$reservation['id']}/complete", [
                'payment_method' => 'cash',
                'amount_paid' => 10000,
            ]);

        $response->assertOk()
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.sale.total', '10000.00');

        // Net stock effect of hold→sale is exactly the sold quantity.
        $this->assertEquals(1, $this->product->fresh()->stock_quantity);

        // Sale exists with the reservation-time price.
        $saleId = $response->json('data.sale_id');
        $this->actingAsUser($this->owner)->getJson("/api/v1/sales/{$saleId}")
            ->assertOk()
            ->assertJsonPath('data.items.0.unit_price', '5000.00');
    }

    public function test_complete_expired_reservation_blocked(): void
    {
        $reservation = $this->reserve();
        $this->actingAsUser($this->owner)->postJson("/api/v1/reservations/{$reservation['id']}/accept");
        Reservation::withoutTenancy()->whereKey($reservation['id'])
            ->update(['expires_at' => now()->subMinute()]); // expired while paying

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/reservations/{$reservation['id']}/complete", [
                'payment_method' => 'cash', 'amount_paid' => 5000,
            ])->assertStatus(409)->assertJsonPath('meta.error_code', 'RESERVATION_EXPIRED');
    }

    // ── Visibility & authz ──────────────────────────────────────────

    public function test_customer_sees_only_own_reservations(): void
    {
        $this->reserve();
        $other = User::factory()->create();

        $this->assertSame(0, $this->actingAsUser($other)
            ->getJson('/api/v1/customer/reservations')
            ->json('meta.pagination.total'));
    }

    public function test_owner_sees_only_own_tenant_reservations(): void
    {
        $this->reserve();

        $otherOwner = User::factory()->shopOwner(Tenant::factory()->provisioned()->create())->create();
        $this->assertSame(0, $this->actingAsUser($otherOwner)
            ->getJson('/api/v1/reservations')
            ->json('meta.pagination.total'));
    }

    public function test_dashboard_counts_pending_reservations(): void
    {
        $this->reserve();
        $this->reserve();

        $this->actingAsUser($this->owner)->getJson('/api/v1/dashboard')
            ->assertOk()
            ->assertJsonPath('data.pending_reservations', 2);
    }

    public function test_staff_without_permission_blocked(): void
    {
        $staff = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create();

        $this->actingAsUser($staff)->getJson('/api/v1/reservations')->assertStatus(403);
    }
}
