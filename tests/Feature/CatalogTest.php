<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\City;
use App\Models\ExpenseCategory;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class CatalogTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);
        $this->tenant = Tenant::factory()->create();
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('test-device', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    // ── Business types ──────────────────────────────────────────────

    public function test_business_types_catalog_is_public(): void
    {
        $response = $this->getJson('/api/v1/business-types')->assertOk();

        $codes = collect($response->json('data'))->pluck('code');
        $this->assertTrue($codes->contains('retail'));
        $this->assertTrue($codes->contains('salon'));

        // Food/restaurant is a live business type: sells online with delivery.
        $restaurant = collect($response->json('data'))->firstWhere('code', 'restaurant');
        $this->assertTrue($restaurant['available']);
        $this->assertTrue($restaurant['features']['marketplace']);
        $this->assertTrue($restaurant['features']['delivery']);
    }

    public function test_setup_seeds_business_type_templates(): void
    {
        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);

        // Business type is set by the admin at creation — simulate that here.
        $this->tenant->update(['business_type' => 'salon']);

        $this->actingAsUser($this->owner)->putJson('/api/v1/shop/setup', [
            'business_category' => 'beauty',
            'city_id' => $city->id,
        ])->assertOk();

        $tenant = $this->tenant->fresh();
        $this->assertSame('salon', $tenant->business_type);
        // Salon matrix: services on, delivery off.
        $this->assertTrue($tenant->featureEnabled('services'));
        $this->assertFalse($tenant->featureEnabled('delivery'));

        // Templates seeded (salon: 6 expense categories, 3 product categories).
        $this->assertSame(6, ExpenseCategory::withoutTenancy()->where('tenant_id', $tenant->id)->count());
        $this->assertSame(3, Category::withoutTenancy()->where('tenant_id', $tenant->id)->count());
    }

    public function test_redoing_setup_never_duplicates_templates(): void
    {
        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);

        // Type is admin-set at creation; setup then applies its defaults.
        $this->tenant->update(['business_type' => 'salon']);

        foreach (range(1, 2) as $i) {
            $this->actingAsUser($this->owner)->putJson('/api/v1/shop/setup', [
                'business_category' => 'beauty',
                'city_id' => $city->id,
            ])->assertOk();
        }

        $this->assertSame(6, ExpenseCategory::withoutTenancy()->where('tenant_id', $this->tenant->id)->count());
    }

    public function test_unavailable_business_type_rejected_at_creation(): void
    {
        // The type is chosen by the ADMIN at tenant creation — an unknown code
        // is rejected there (the owner never picks a type).
        $admin = User::factory()->superAdmin()->create();

        $this->actingAsUser($admin)->postJson('/api/v1/admin/tenants', [
            'business_name' => 'Spaceship Co',
            'business_type' => 'spaceship-dealer', // not a real business type
            'owner' => ['name' => 'O', 'email' => 'o@space.test', 'password' => 'password123'],
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['business_type']]);
    }

    // ── Categories ──────────────────────────────────────────────────

    public function test_category_crud_and_nesting(): void
    {
        $root = $this->actingAsUser($this->owner)->postJson('/api/v1/categories', [
            'name' => 'Clothing',
        ])->assertCreated()->json('data');

        $this->actingAsUser($this->owner)->postJson('/api/v1/categories', [
            'name' => 'Shirts',
            'parent_id' => $root['id'],
        ])->assertCreated();

        $tree = $this->actingAsUser($this->owner)->getJson('/api/v1/categories')->json('data');
        $clothing = collect($tree)->firstWhere('name', 'Clothing');
        $this->assertSame('Shirts', $clothing['children'][0]['name']);
    }

    public function test_duplicate_sibling_category_name_rejected(): void
    {
        Category::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'name' => 'Clothing']);

        $this->actingAsUser($this->owner)->postJson('/api/v1/categories', [
            'name' => 'Clothing',
        ])->assertStatus(422);
    }

    public function test_circular_category_parent_blocked(): void
    {
        $a = Category::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'name' => 'A']);
        $b = Category::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'name' => 'B', 'parent_id' => $a->id]);

        // A cannot become a child of its own descendant B.
        $this->actingAsUser($this->owner)->putJson("/api/v1/categories/{$a->id}", [
            'parent_id' => $b->id,
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'CATEGORY_CIRCULAR');

        // And self-parenting is blocked.
        $this->actingAsUser($this->owner)->putJson("/api/v1/categories/{$a->id}", [
            'parent_id' => $a->id,
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'CATEGORY_SELF_PARENT');
    }

    public function test_delete_category_with_products_blocked_unless_reassigned(): void
    {
        $cat = Category::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'name' => 'Shoes']);
        $other = Category::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'name' => 'General']);
        Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product',
            'name' => 'Sneaker', 'price' => 100, 'category_id' => $cat->id,
        ]);

        $this->actingAsUser($this->owner)->deleteJson("/api/v1/categories/{$cat->id}")
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'CATEGORY_HAS_PRODUCTS');

        $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/categories/{$cat->id}?reassign_to={$other->id}")
            ->assertOk();

        $this->assertSame($other->id, Product::withoutTenancy()->first()->category_id);
    }

    // ── Items: products & services ──────────────────────────────────

    public function test_create_product_with_variants(): void
    {
        $response = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'type' => 'product',
            'name' => 'T-Shirt',
            'sku' => 'TS-001',
            'price' => 1500,
            'cost' => 900,
            'stock_quantity' => 10,
            'variants' => [
                ['name' => 'Red / L', 'sku' => 'TS-001-RL', 'price' => 1500, 'stock_quantity' => 5],
                ['name' => 'Blue / M', 'sku' => 'TS-001-BM', 'price' => 1600, 'stock_quantity' => 5],
            ],
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.name', 'T-Shirt')
            ->assertJsonCount(2, 'data.variants');
    }

    public function test_duplicate_sku_within_tenant_rejected(): void
    {
        Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product',
            'name' => 'Existing', 'sku' => 'TS-001', 'price' => 10,
        ]);

        $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'type' => 'product', 'name' => 'New', 'sku' => 'TS-001', 'price' => 20,
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['sku']]);
    }

    public function test_same_sku_allowed_for_different_tenant(): void
    {
        $otherTenant = Tenant::factory()->create();
        Product::withoutTenancy()->create([
            'tenant_id' => $otherTenant->id, 'type' => 'product',
            'name' => 'Other shop item', 'sku' => 'TS-001', 'price' => 10,
        ]);

        $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'type' => 'product', 'name' => 'Mine', 'sku' => 'TS-001', 'price' => 20,
        ])->assertCreated();
    }

    public function test_tenant_isolation_on_products(): void
    {
        $otherTenant = Tenant::factory()->create();
        $foreign = Product::withoutTenancy()->create([
            'tenant_id' => $otherTenant->id, 'type' => 'product',
            'name' => 'Foreign product', 'price' => 10,
        ]);

        // List never leaks other tenants' items…
        $list = $this->actingAsUser($this->owner)->getJson('/api/v1/products')->json('data');
        $this->assertCount(0, $list);

        // …and direct access is 404, not 403 (existence not revealed).
        $this->actingAsUser($this->owner)->getJson("/api/v1/products/{$foreign->id}")
            ->assertStatus(404);
    }

    public function test_create_service_without_stock(): void
    {
        $response = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'type' => 'service',
            'name' => 'Haircut',
            'price' => 800,
            'duration_minutes' => 30,
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.type', 'service')
            ->assertJsonPath('data.track_inventory', false)
            ->assertJsonPath('data.duration_minutes', 30);
    }

    public function test_service_cannot_have_stock_or_variants(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'type' => 'service',
            'name' => 'Haircut',
            'price' => 800,
            'stock_quantity' => 5,
            'variants' => [['name' => 'Long hair', 'price' => 1000]],
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['stock_quantity', 'variants']]);
    }

    public function test_price_below_cost_warns_but_succeeds(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'type' => 'product', 'name' => 'Clearance', 'price' => 50, 'cost' => 100,
        ])->assertCreated()
            ->assertJsonPath('meta.warnings.0', 'Selling price is below cost — this item sells at a loss.');
    }

    public function test_update_cannot_change_type_or_stock(): void
    {
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product',
            'name' => 'Item', 'price' => 10, 'stock_quantity' => 5,
        ]);

        $this->actingAsUser($this->owner)->putJson("/api/v1/products/{$product->id}", [
            'type' => 'service',
            'stock_quantity' => 99,
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['type', 'stock_quantity']]);
    }

    public function test_delete_is_soft_and_history_survives(): void
    {
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product',
            'name' => 'Old item', 'price' => 10,
        ]);

        $this->actingAsUser($this->owner)->deleteJson("/api/v1/products/{$product->id}")->assertOk();

        $this->assertSoftDeleted('products', ['id' => $product->id]);
    }

    public function test_staff_without_products_permission_blocked(): void
    {
        $staff = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE])->create();

        $this->actingAsUser($staff)->getJson('/api/v1/products')->assertStatus(403);
        $this->actingAsUser($staff)->postJson('/api/v1/products', [
            'type' => 'product', 'name' => 'X', 'price' => 1,
        ])->assertStatus(403);
    }

    public function test_low_stock_filter(): void
    {
        Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product',
            'name' => 'Low', 'price' => 10, 'stock_quantity' => 2, 'low_stock_threshold' => 5,
        ]);
        Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product',
            'name' => 'Fine', 'price' => 10, 'stock_quantity' => 50, 'low_stock_threshold' => 5,
        ]);

        $list = $this->actingAsUser($this->owner)->getJson('/api/v1/products?low_stock=1')->json('data');

        $this->assertCount(1, $list);
        $this->assertSame('Low', $list[0]['name']);
    }

    // ── Expense categories ──────────────────────────────────────────

    public function test_expense_categories_editable_after_seeding(): void
    {
        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        // Type is admin-set at creation; that seeds the expenses feature + defaults.
        $this->tenant->update(['business_type' => 'retail']);
        $this->actingAsUser($this->owner)->putJson('/api/v1/shop/setup', [
            'business_category' => 'garments', 'city_id' => $city->id,
        ])->assertOk();

        // Owner adds a custom category…
        $created = $this->actingAsUser($this->owner)->postJson('/api/v1/expense-categories', [
            'name' => 'Chai for customers',
        ])->assertCreated()->json('data');

        // …renames a default one…
        $list = $this->actingAsUser($this->owner)->getJson('/api/v1/expense-categories')->json('data');
        $rent = collect($list)->firstWhere('name', 'Rent');
        $this->actingAsUser($this->owner)->putJson("/api/v1/expense-categories/{$rent['id']}", [
            'name' => 'Shop Rent',
        ])->assertOk();

        // …and deletes the custom one.
        $this->actingAsUser($this->owner)->deleteJson("/api/v1/expense-categories/{$created['id']}")
            ->assertOk();
    }
}
