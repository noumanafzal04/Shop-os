<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * SERVICES business-type edge cases:
 *   - a service sale never touches stock (no StockMovement, no quantity drift)
 *   - duration_minutes is service-only on BOTH create and update
 *   - the services type defaults sane features (reservations OFF) and its
 *     catalog is constrained to service items
 *   - legacy service-ish codes (salon, workshop) still resolve and trade
 */
class ServicesEdgeCasesTest extends TestCase
{
    use RefreshDatabase;

    private function shop(string $businessType = 'services', array $overrides = []): array
    {
        $city = City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
        $tenant = Tenant::factory()->create(array_merge([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => $businessType,
            'features' => BusinessTypes::defaultFeatures($businessType),
            'timezone' => 'UTC',
        ], $overrides));
        $owner = User::factory()->shopOwner($tenant)->create();

        return [$tenant, $owner];
    }

    private function actingAsUser(User $user): static
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    // ── (1) Selling a service moves no stock, anywhere ───────────────

    public function test_selling_a_service_creates_no_stock_movements_and_no_stock_change(): void
    {
        [, $owner] = $this->shop('services');

        $haircut = $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => 'service', 'name' => 'Haircut', 'price' => 800, 'duration_minutes' => 30,
        ])->assertCreated()->json('data');
        $this->assertFalse($haircut['track_inventory']);

        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 1600,
            'items' => [['product_id' => $haircut['id'], 'quantity' => 2]],
        ])->assertCreated()->json('data');

        $this->assertSame('completed', $sale['status']);
        $this->assertSame('1600.00', (string) $sale['total']);

        // ZERO movements in the whole system, and the item's own counter
        // never drifted — services simply have no stock life.
        $this->assertSame(0, StockMovement::withoutTenancy()->count());
        $product = Product::withoutTenancy()->find($haircut['id']);
        $this->assertSame(0.0, (float) $product->stock_quantity);
    }

    public function test_mixed_cart_moves_only_the_physical_line(): void
    {
        // Legacy 'workshop' sells parts (physical, tracked) AND labour (service).
        [$tenant, $owner] = $this->shop('workshop');
        $part = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Brake Pad', 'price' => 1500, 'stock_quantity' => 10, 'track_inventory' => true,
        ]);
        $labour = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'service', 'item_type' => 'service',
            'name' => 'Fitting Labour', 'price' => 500, 'track_inventory' => false,
        ]);

        $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 2000,
            'items' => [
                ['product_id' => $part->id, 'quantity' => 1],
                ['product_id' => $labour->id, 'quantity' => 1],
            ],
        ])->assertCreated();

        // Exactly ONE movement — the part. The labour line left no trace.
        $movements = StockMovement::withoutTenancy()->get();
        $this->assertCount(1, $movements);
        $this->assertSame($part->id, $movements->first()->product_id);
        $this->assertSame(9.0, (float) $part->refresh()->stock_quantity);
        $this->assertSame(0.0, (float) $labour->refresh()->stock_quantity);
    }

    // ── (2) duration_minutes is service-only, create AND update ──────

    public function test_duration_is_accepted_on_services_on_create_and_update(): void
    {
        [, $owner] = $this->shop('services');

        $svc = $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => 'service', 'name' => 'Full Detail', 'price' => 5000, 'duration_minutes' => 90,
        ])->assertCreated()->json('data');
        $this->assertSame(90, $svc['duration_minutes']);
        $this->assertSame('service', $svc['type']);

        $this->actingAsUser($owner)->putJson("/api/v1/products/{$svc['id']}", [
            'duration_minutes' => 120,
        ])->assertOk()->assertJsonPath('data.duration_minutes', 120);
    }

    public function test_duration_is_rejected_on_physical_products_on_create_and_update(): void
    {
        [$tenant, $owner] = $this->shop('retail');

        // Create path: prohibited outright.
        $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'Iron', 'price' => 4000,
            'duration_minutes' => 30,
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['duration_minutes']]);

        // Update path: an existing physical product can't grow a duration.
        $fan = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Fan', 'price' => 3000, 'stock_quantity' => 5,
        ]);
        $this->actingAsUser($owner)->putJson("/api/v1/products/{$fan->id}", [
            'duration_minutes' => 30,
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['duration_minutes']]);
    }

    // ── (3) Type defaults + catalog constraint ───────────────────────

    public function test_services_type_default_features_fit_the_type(): void
    {
        $features = BusinessTypes::defaultFeatures('services');

        $this->assertTrue($features['services']);
        $this->assertFalse($features['reservations']); // engine holds PRODUCT stock — no appointments yet
        $this->assertFalse($features['products']);
        $this->assertFalse($features['inventory']);
        $this->assertFalse($features['delivery']);
        $this->assertFalse($features['marketplace']);
        // Universal defaults still merge in.
        $this->assertTrue($features['pos']);
        $this->assertTrue($features['expenses']);
    }

    public function test_services_tenant_cannot_catalog_medicine_or_food(): void
    {
        [, $owner] = $this->shop('services');

        $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => 'medicine', 'name' => 'Panadol', 'price' => 50,
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['item_type']]);

        $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => 'food_item', 'name' => 'Chai', 'price' => 100,
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['item_type']]);

        // Its own item type stays allowed.
        $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => 'service', 'name' => 'Threading', 'price' => 200,
        ])->assertCreated();
    }

    public function test_services_tenant_with_products_feature_flipped_on_still_cannot_catalog_physical(): void
    {
        // KNOWN: itemTypesFor() reads the TYPE's static feature defaults, not
        // the tenant's own feature map — so a services shop whose `products`
        // feature was switched on per-tenant (the documented path for a salon
        // that also sells retail) is still 422-blocked from physical_product.
        [, $owner] = $this->shop('services', [
            'features' => array_merge(BusinessTypes::defaultFeatures('services'), ['products' => true, 'inventory' => true]),
        ]);

        $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'Shampoo Bottle', 'price' => 900, 'stock_quantity' => 5,
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['item_type']]);
    }

    // ── (4) Legacy service-ish business types still work ─────────────

    public function test_legacy_salon_tenant_resolves_features_and_completes_a_sale(): void
    {
        // 'salon' is hidden from the picker but must keep resolving.
        $features = BusinessTypes::defaultFeatures('salon');
        $this->assertTrue($features['services']);
        $this->assertTrue($features['products']); // salons also sell retail
        $this->assertTrue($features['pos']);

        [, $owner] = $this->shop('salon');

        // Both its item types create fine through the API.
        $facial = $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => 'service', 'name' => 'Facial', 'price' => 2500, 'duration_minutes' => 45,
        ])->assertCreated()->json('data');
        $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'Hair Serum', 'price' => 1200, 'stock_quantity' => 8,
        ])->assertCreated();

        // And the till still rings a service sale end-to-end.
        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 2500,
            'items' => [['product_id' => $facial['id'], 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertSame('completed', $sale['status']);
        $this->assertSame('2500.00', (string) $sale['total']);
        $this->assertSame(0, StockMovement::withoutTenancy()->count());
    }
}
