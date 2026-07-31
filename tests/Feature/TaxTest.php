<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\TaxGroup;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Tax engine: inclusive vs exclusive mode, and reusable tax groups.
 *
 *  - EXCLUSIVE (default): tax is added on top of the price at checkout.
 *  - INCLUSIVE: the price already contains tax — the total isn't inflated and
 *    the receipt shows the portion held within; a return must not add it back.
 *  - Tax GROUP: a named rate a product points at; it wins over the product's
 *    own tax_rate and the shop default.
 */
class TaxTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'), 'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function setSetting(string $key, mixed $value): void
    {
        $this->tenant->forceFill(['settings' => array_merge($this->tenant->settings ?? [], [$key => $value])])->save();
        $this->tenant->refresh();
    }

    private function product(array $over): Product
    {
        return Product::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Item', 'price' => 100, 'stock_quantity' => 100, 'track_inventory' => true,
        ], $over));
    }

    /** @param array<int, array{0: Product, 1: float}> $items */
    private function sell(array $items, array $extra = []): TestResponse
    {
        return $this->actingAsUser($this->owner)->postJson('/api/v1/sales', array_merge([
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 1000000,
            'items' => array_map(fn ($i) => ['product_id' => $i[0]->id, 'quantity' => $i[1]], $items),
        ], $extra));
    }

    // ── Inclusive vs exclusive ───────────────────────────────────────

    public function test_exclusive_tax_adds_on_top(): void
    {
        $p = $this->product(['price' => 100, 'tax_rate' => 18]);

        $sale = $this->sell([[$p, 1]])->assertCreated()->json('data');

        $this->assertSame('18.00', $sale['tax']);
        $this->assertSame('118.00', $sale['total']);
        $this->assertFalse((bool) $sale['tax_inclusive']);
    }

    public function test_inclusive_tax_extracts_portion_and_keeps_total(): void
    {
        $this->setSetting('tax_inclusive', true);
        $p = $this->product(['price' => 118, 'tax_rate' => 18]); // 100 net + 18 tax, shown as 118

        $sale = $this->sell([[$p, 1]])->assertCreated()->json('data');

        // Total stays the sticker price; tax is the portion held within.
        $this->assertSame('118.00', $sale['total']);
        $this->assertSame('18.00', $sale['tax']);
        $this->assertTrue((bool) $sale['tax_inclusive']);
    }

    public function test_inclusive_exempt_line_has_no_extracted_tax(): void
    {
        $this->setSetting('tax_inclusive', true);
        $p = $this->product(['price' => 200, 'tax_rate' => 0]);

        $sale = $this->sell([[$p, 1]])->assertCreated()->json('data');

        $this->assertSame('0.00', $sale['tax']);
        $this->assertSame('200.00', $sale['total']);
    }

    public function test_inclusive_return_refunds_the_sticker_price_without_adding_tax(): void
    {
        $this->setSetting('tax_inclusive', true);
        $p = $this->product(['price' => 118, 'tax_rate' => 18, 'cost' => 50]);

        $sale = $this->sell([[$p, 1]])->assertCreated()->json('data');

        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertCreated()
            // Refund equals what they paid (118), with 18 of it flagged as the
            // tax portion within — NOT 118 + 18.
            ->assertJsonPath('data.refund_total', '118.00')
            ->assertJsonPath('data.refund_tax', '18.00');
    }

    // ── Tax groups ───────────────────────────────────────────────────

    public function test_tax_group_rate_wins_over_product_rate(): void
    {
        $gst = TaxGroup::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'GST 17%', 'rate' => 17, 'is_active' => true,
        ]);
        // A stale per-product rate of 5 must be ignored in favour of the group.
        $p = $this->product(['price' => 100, 'tax_rate' => 5, 'tax_group_id' => $gst->id]);

        $sale = $this->sell([[$p, 1]])->assertCreated()->json('data');

        $this->assertSame('17.00', $sale['tax']);
        $this->assertSame('117.00', $sale['total']);
    }

    public function test_zero_rated_group_exempts_even_when_a_shop_default_exists(): void
    {
        $this->setSetting('default_tax_rate', 17);
        $zero = TaxGroup::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Zero-rated', 'rate' => 0, 'is_active' => true,
        ]);
        $p = $this->product(['price' => 100, 'tax_group_id' => $zero->id]); // no own rate

        $sale = $this->sell([[$p, 1]])->assertCreated()->json('data');

        $this->assertSame('0.00', $sale['tax']);
        $this->assertSame('100.00', $sale['total']);
    }

    public function test_editing_a_group_re_rates_every_product_on_it(): void
    {
        $g = TaxGroup::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Std', 'rate' => 10, 'is_active' => true,
        ]);
        $p = $this->product(['price' => 100, 'tax_group_id' => $g->id]);

        $this->assertSame('10.00', $this->sell([[$p, 1]])->json('data')['tax']);

        $this->actingAsUser($this->owner)->putJson("/api/v1/tax-groups/{$g->id}", ['name' => 'Std', 'rate' => 25])
            ->assertOk();

        // Same product, no edit — the next sale re-rates from the group.
        $this->assertSame('25.00', $this->sell([[$p, 1]])->json('data')['tax']);
    }

    public function test_tax_group_crud(): void
    {
        $created = $this->actingAsUser($this->owner)->postJson('/api/v1/tax-groups', [
            'name' => 'Reduced', 'rate' => 5,
        ])->assertCreated()->json('data');

        $this->actingAsUser($this->owner)->getJson('/api/v1/tax-groups')
            ->assertOk()->assertJsonFragment(['name' => 'Reduced']);

        $this->actingAsUser($this->owner)->deleteJson("/api/v1/tax-groups/{$created['id']}")
            ->assertOk();

        $this->assertSoftDeleted('tax_groups', ['id' => $created['id']]);
    }

    public function test_deleting_a_group_nulls_it_on_products(): void
    {
        $g = TaxGroup::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Temp', 'rate' => 8, 'is_active' => true,
        ]);
        $p = $this->product(['tax_group_id' => $g->id]);

        $g->delete(); // soft delete; FK nullOnDelete only fires on hard delete
        $g->forceDelete();

        $this->assertNull($p->fresh()->tax_group_id);
    }

    public function test_rate_over_100_is_rejected(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/tax-groups', [
            'name' => 'Bad', 'rate' => 150,
        ])->assertStatus(422)->assertJsonValidationErrors(['rate']);
    }
}
