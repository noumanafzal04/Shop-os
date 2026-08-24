<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchSoldOut;
use App\Models\City;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A KITCHEN RUNS OUT. A CHAIN DOES NOT.
 *
 * Eighty-sixing belonged to the shop, so a chain with two kitchens had one
 * switch between them: Gulberg ran out of bases, the chef took the pizza off,
 * and DHA — with a full tray — stopped selling it too.
 *
 * Same argument as per-size 86 a week earlier, one dimension further out.
 */
class OneBranchRunsOutTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $pizza;

    private Branch $gulberg;

    private Branch $dha;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id, 'business_type' => 'food',
            'features' => BusinessTypes::defaultFeatures('food'), 'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();

        $this->gulberg = Branch::withoutTenancy()->where('tenant_id', $this->shop->id)->where('is_default', true)->first();
        $this->dha = Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'DHA', 'is_default' => false, 'is_active' => true,
        ]);

        $this->pizza = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => 'Pizza', 'price' => 900, 'track_inventory' => false, 'is_active' => true,
        ]);
    }

    private function at(Branch $branch): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token)->withHeader('X-Branch-Id', $branch->id);
    }

    private function sellAt(Branch $branch, array $line): TestResponse
    {
        // Pay whatever it costs. A short payment is its own 422 and would read
        // exactly like the refusal these tests are about.
        return $this->at($branch)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 100000,
            'items' => [$line],
        ]);
    }

    public function test_one_kitchen_running_out_leaves_the_other_selling(): void
    {
        $this->at($this->gulberg)
            ->postJson("/api/v1/products/{$this->pizza->id}/sold-out")
            ->assertOk();

        // Gulberg refuses.
        $this->sellAt($this->gulberg, ['product_id' => $this->pizza->id, 'quantity' => 1])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'ITEM_SOLD_OUT');

        // DHA has a full tray and must keep selling. This is the whole feature.
        $this->sellAt($this->dha, ['product_id' => $this->pizza->id, 'quantity' => 1])
            ->assertCreated();
    }

    public function test_putting_it_back_is_also_per_branch(): void
    {
        $this->at($this->gulberg)->postJson("/api/v1/products/{$this->pizza->id}/sold-out")->assertOk();
        $this->at($this->dha)->postJson("/api/v1/products/{$this->pizza->id}/sold-out")->assertOk();

        $this->at($this->dha)->deleteJson("/api/v1/products/{$this->pizza->id}/sold-out")->assertOk();

        // DHA back on, Gulberg still off — one press must not reach across.
        $this->sellAt($this->dha, ['product_id' => $this->pizza->id, 'quantity' => 1])->assertCreated();
        $this->sellAt($this->gulberg, ['product_id' => $this->pizza->id, 'quantity' => 1])->assertStatus(422);
    }

    public function test_a_size_runs_out_at_one_branch_only(): void
    {
        $large = ProductVariant::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'product_id' => $this->pizza->id,
            'name' => 'Large', 'price' => 1200, 'is_active' => true,
        ]);
        $small = ProductVariant::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'product_id' => $this->pizza->id,
            'name' => 'Small', 'price' => 700, 'is_active' => true,
        ]);

        $this->at($this->gulberg)
            ->postJson("/api/v1/products/{$this->pizza->id}/variants/{$large->id}/sold-out")
            ->assertOk();

        // Both dimensions at once: the Large is off HERE, and nothing else is.
        $this->sellAt($this->gulberg, ['product_id' => $this->pizza->id, 'variant_id' => $large->id, 'quantity' => 1])
            ->assertStatus(422);
        $this->sellAt($this->gulberg, ['product_id' => $this->pizza->id, 'variant_id' => $small->id, 'quantity' => 1])
            ->assertCreated();
        $this->sellAt($this->dha, ['product_id' => $this->pizza->id, 'variant_id' => $large->id, 'quantity' => 1])
            ->assertCreated();
    }

    public function test_pressing_twice_at_one_branch_keeps_the_first_time(): void
    {
        $this->at($this->gulberg)->postJson("/api/v1/products/{$this->pizza->id}/sold-out")->assertOk();
        $first = BranchSoldOut::withoutTenancy()->where('branch_id', $this->gulberg->id)->value('sold_out_at');

        $this->travel(5)->minutes();
        $this->at($this->gulberg)->postJson("/api/v1/products/{$this->pizza->id}/sold-out")->assertOk();

        $this->assertEquals(
            $first,
            BranchSoldOut::withoutTenancy()->where('branch_id', $this->gulberg->id)->value('sold_out_at'),
            '"off since Tuesday" is the point of storing a time rather than a flag',
        );
        $this->assertSame(1, BranchSoldOut::withoutTenancy()->count(), 'a second press wrote a second row');
    }

    public function test_the_till_is_told_what_it_s_branch_has_run_out_of(): void
    {
        $this->at($this->gulberg)->postJson("/api/v1/products/{$this->pizza->id}/sold-out")->assertOk();

        $offHere = collect($this->at($this->gulberg)->getJson('/api/v1/pos/catalog')
            ->assertOk()->json('data.products.items'))->firstWhere('id', $this->pizza->id);
        $offThere = collect($this->at($this->dha)->getJson('/api/v1/pos/catalog')
            ->assertOk()->json('data.products.items'))->firstWhere('id', $this->pizza->id);

        $this->assertTrue($offHere['sold_out'] ?? null, "Gulberg's till was not told");
        $this->assertFalse($offThere['sold_out'] ?? null, "DHA's till was told about a kitchen it does not have");
    }
}
