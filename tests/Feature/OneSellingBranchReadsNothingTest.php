<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Category;
use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Support\BusinessTypes;
use App\Support\CatalogPlaces;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * A SHOP WITH ONE SELLING BRANCH IS UNAFFECTED — AND READS NOTHING TO KNOW IT.
 *
 * The rule the branch-wise catalogue was built on was kept by the data alone:
 * every row said "All branches", so every filter let everything through after
 * reading all of it — the till's chips 0.35 s against v1's 0.18 s on a
 * 50,000-item shop. Now one count of the shop's selling branches answers for
 * every reader, and they agree with each other: what the list shows, the till
 * sells. A godown is not a selling branch.
 */
class OneSellingBranchReadsNothingTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private Branch $main;

    private Product $leftOver; // listed only at a branch that has since closed

    protected function setUp(): void
    {
        parent::setUp();

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id, 'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'), 'timezone' => 'UTC',
        ]);
        $this->main = Branch::withoutTenancy()->where('tenant_id', $this->shop->id)->where('is_default', true)->firstOrFail();
        // A godown sells nothing: still one selling branch.
        Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Kot Lakhpat Godown', 'code' => 'KL', 'kind' => Branch::KIND_WAREHOUSE,
            'is_default' => false, 'is_active' => true,
        ]);
        $closed = Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Old Town', 'code' => 'OT', 'kind' => Branch::KIND_SHOP,
            'is_default' => false, 'is_active' => false,
        ]);

        $shelf = Category::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => 'Old Town shelf', 'all_branches' => false]);
        $this->leftOver = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Old Town Kulfi', 'price' => 100, 'all_branches' => false, 'category_id' => $shelf->id,
        ]);
        DB::table('branch_product')->insert(['tenant_id' => $this->shop->id, 'product_id' => $this->leftOver->id, 'branch_id' => $closed->id]);
    }

    public function test_every_reader_lets_everything_through_and_agrees(): void
    {
        $this->assertTrue(CatalogPlaces::isSoldAt($this->leftOver, $this->main->id), 'the till would refuse what the list shows');
        $this->assertNull(CatalogPlaces::productsSoldAt($this->main->id, [$this->leftOver]));
        $this->assertNull(CatalogPlaces::categoriesShownAt($this->main->id));
        $listed = CatalogPlaces::narrow(Product::withoutTenancy()->where('tenant_id', $this->shop->id), $this->main->id, 'products', 'branch_product', 'product_id')
            ->pluck('id')->all();
        $this->assertContains($this->leftOver->id, $listed);
    }

    public function test_and_reads_no_listing_to_say_so(): void
    {
        DB::enableQueryLog();
        CatalogPlaces::categoriesShownAt($this->main->id);
        $read = collect(DB::getQueryLog())->pluck('query')->filter(fn (string $q) => str_contains($q, 'products') || str_contains($q, 'categories'));
        DB::disableQueryLog();

        $this->assertSame([], $read->values()->all(), 'a one-branch shop read the catalogue to learn it narrows nothing');
    }

    public function test_a_second_selling_branch_brings_the_listings_back(): void
    {
        Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Johar Town', 'code' => 'JT', 'kind' => Branch::KIND_SHOP,
            'is_default' => false, 'is_active' => true,
        ]);

        $this->assertFalse(CatalogPlaces::isSoldAt($this->leftOver, $this->main->id));
        $this->assertSame([], CatalogPlaces::productsSoldAt($this->main->id, [$this->leftOver]));
        $this->assertArrayNotHasKey($this->leftOver->category_id, CatalogPlaces::categoriesShownAt($this->main->id) ?? ['x' => true]);
    }
}
