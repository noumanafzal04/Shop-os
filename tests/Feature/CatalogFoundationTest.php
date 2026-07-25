<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Collection;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * The universal catalog foundation: item-type capability model, unlimited
 * category nesting + reorder, and collections.
 */
class CatalogFoundationTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => null, // type-less (legacy) tenant: these are ITEM-TYPE capability tests, not business-type-constraint tests
            'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    // ── Item types & capabilities ───────────────────────────────────

    public function test_physical_product_tracks_stock_by_default(): void
    {
        $data = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'Shirt', 'price' => 1000,
        ])->assertCreated()->json('data');

        $this->assertSame('physical_product', $data['item_type']);
        $this->assertSame('product', $data['type']);       // coarse derived
        $this->assertTrue($data['track_inventory']);
    }

    public function test_food_item_does_not_track_stock_by_default(): void
    {
        $data = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'food_item', 'name' => 'Pizza', 'price' => 1200,
        ])->assertCreated()->json('data');

        $this->assertSame('food_item', $data['item_type']);
        $this->assertFalse($data['track_inventory']); // optional → off by default
    }

    public function test_service_rejects_stock_and_variants(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'service', 'name' => 'Haircut', 'price' => 800,
            'stock_quantity' => 5,
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['stock_quantity']]);

        $data = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'service', 'name' => 'Haircut', 'price' => 800, 'duration_minutes' => 30,
        ])->assertCreated()->json('data');
        $this->assertSame('service', $data['type']);
        $this->assertFalse($data['track_inventory']);
    }

    public function test_legacy_type_field_still_maps_to_item_type(): void
    {
        // Old clients sending only `type` keep working.
        $data = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'type' => 'service', 'name' => 'Repair', 'price' => 500, 'duration_minutes' => 20,
        ])->assertCreated()->json('data');
        $this->assertSame('service', $data['item_type']);
    }

    public function test_barcode_is_unique_per_tenant(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'A', 'price' => 10, 'barcode' => '8901234567890',
        ])->assertCreated();

        $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'B', 'price' => 10, 'barcode' => '8901234567890',
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['barcode']]);
    }

    public function test_item_type_cannot_change_on_update(): void
    {
        $id = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'X', 'price' => 10,
        ])->json('data.id');

        $this->actingAsUser($this->owner)->putJson("/api/v1/products/{$id}", [
            'item_type' => 'service',
        ])->assertStatus(422);
    }

    // ── Unlimited nesting + reorder ─────────────────────────────────

    public function test_categories_nest_three_levels_deep(): void
    {
        $l1 = $this->actingAsUser($this->owner)->postJson('/api/v1/categories', ['name' => 'Electronics'])->json('data');
        $l2 = $this->actingAsUser($this->owner)->postJson('/api/v1/categories', ['name' => 'Phones', 'parent_id' => $l1['id']])->json('data');
        $l3 = $this->actingAsUser($this->owner)->postJson('/api/v1/categories', ['name' => 'Android', 'parent_id' => $l2['id']])->json('data');

        $tree = $this->actingAsUser($this->owner)->getJson('/api/v1/categories')->json('data');
        $electronics = collect($tree)->firstWhere('name', 'Electronics');
        $this->assertSame('Phones', $electronics['children'][0]['name']);
        $this->assertSame('Android', $electronics['children'][0]['children'][0]['name']);
        $this->assertSame($l3['id'], $electronics['children'][0]['children'][0]['id']);
    }

    public function test_reorder_reparents_and_blocks_cycles(): void
    {
        $a = $this->actingAsUser($this->owner)->postJson('/api/v1/categories', ['name' => 'A'])->json('data');
        $b = $this->actingAsUser($this->owner)->postJson('/api/v1/categories', ['name' => 'B'])->json('data');

        // Move B under A.
        $this->actingAsUser($this->owner)->postJson('/api/v1/categories/reorder', [
            'categories' => [['id' => $b['id'], 'parent_id' => $a['id'], 'sort_order' => 0]],
        ])->assertOk();

        $tree = $this->actingAsUser($this->owner)->getJson('/api/v1/categories')->json('data');
        $this->assertSame('B', collect($tree)->firstWhere('name', 'A')['children'][0]['name']);

        // Cannot make A a child of its own descendant B.
        $this->actingAsUser($this->owner)->postJson('/api/v1/categories/reorder', [
            'categories' => [['id' => $a['id'], 'parent_id' => $b['id'], 'sort_order' => 0]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'CATEGORY_CYCLE');
    }

    // ── Collections ─────────────────────────────────────────────────

    public function test_collection_crud_and_item_attachment(): void
    {
        $p1 = $this->actingAsUser($this->owner)->postJson('/api/v1/products', ['item_type' => 'physical_product', 'name' => 'P1', 'price' => 10])->json('data.id');
        $p2 = $this->actingAsUser($this->owner)->postJson('/api/v1/products', ['item_type' => 'physical_product', 'name' => 'P2', 'price' => 20])->json('data.id');

        $col = $this->actingAsUser($this->owner)->postJson('/api/v1/collections', [
            'name' => 'Best Sellers', 'item_ids' => [$p1, $p2],
        ])->assertCreated()->json('data');

        $this->assertSame('best-sellers', $col['slug']);
        $this->assertCount(2, $col['items']);

        // Re-sync to a single item.
        $this->actingAsUser($this->owner)->putJson("/api/v1/collections/{$col['id']}", [
            'item_ids' => [$p1],
        ])->assertOk();
        $this->assertSame(1, Collection::withoutTenancy()->find($col['id'])->items()->count());
    }

    public function test_collections_are_isolated_per_tenant(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/collections', ['name' => 'Mine'])->assertCreated();

        $other = User::factory()->shopOwner()->create();
        $this->assertCount(0, $this->actingAsUser($other)->getJson('/api/v1/collections')->json('data'));
    }

    public function test_generate_barcode_assigns_unique_scannable_code(): void
    {
        $id = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'NoCode', 'price' => 10,
        ])->json('data.id');

        $barcode = $this->actingAsUser($this->owner)->postJson("/api/v1/products/{$id}/barcode")
            ->assertOk()->json('data.barcode');
        $this->assertNotEmpty($barcode);
        $this->assertMatchesRegularExpression('/^\d{12}$/', $barcode);

        // Idempotent-ish: keeps the existing code on a second call.
        $again = $this->actingAsUser($this->owner)->postJson("/api/v1/products/{$id}/barcode")->json('data.barcode');
        $this->assertSame($barcode, $again);
    }

    public function test_product_can_be_filtered_by_item_type(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/products', ['item_type' => 'physical_product', 'name' => 'Phys', 'price' => 10]);
        $this->actingAsUser($this->owner)->postJson('/api/v1/products', ['item_type' => 'service', 'name' => 'Svc', 'price' => 10, 'duration_minutes' => 15]);

        $svc = $this->actingAsUser($this->owner)->getJson('/api/v1/products?item_type=service')->json('data');
        $this->assertCount(1, $svc);
        $this->assertSame('Svc', $svc[0]['name']);
    }
}
