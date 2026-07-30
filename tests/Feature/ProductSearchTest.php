<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Product search must match the fields the counter actually types: name,
 * brand, generic/salt, SKU, barcode (already covered) plus DESCRIPTION and
 * CATEGORY name.
 */
class ProductSearchTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'), 'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function search(string $term): array
    {
        return $this->actingAsUser($this->owner)
            ->getJson('/api/v1/products?search='.urlencode($term))
            ->assertOk()->json('data');
    }

    public function test_search_matches_the_description(): void
    {
        Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Mystery Box', 'description' => 'Contains imported Belgian chocolate', 'price' => 100,
        ]);

        $results = $this->search('belgian chocolate');
        $this->assertCount(1, $results);
        $this->assertSame('Mystery Box', $results[0]['name']);
    }

    public function test_search_matches_the_category_name(): void
    {
        $category = Category::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Beverages', 'sort_order' => 0, 'is_active' => true,
        ]);
        Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Cola 1.5L', 'category_id' => $category->id, 'price' => 120,
        ]);

        $results = $this->search('beverages');
        $this->assertCount(1, $results);
        $this->assertSame('Cola 1.5L', $results[0]['name']);
    }
}
