<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * WHAT GOES OFF KEEPS ITS DATE FROM THE DAY IT IS CARDED.
 *
 * Tester pass 4 (B60), Rehmat Mart: a yogurt made with opening stock, a batch
 * number and an expiry kept neither. The request accepted both and the action
 * made a lot only for a medicine — so the first yogurt sold was never the
 * oldest, and the expiring list never named it.
 */
class AnOpeningLotIsKeptForWhatGoesOffTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $mart = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'), 'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($mart)->create();
    }

    private function card(array $with): Product
    {
        $id = $this->withToken($this->owner->createToken('t', ['access'])->plainTextToken)
            ->postJson('/api/v1/products', [
                'item_type' => 'physical_product', 'name' => 'Yogurt 500g', 'price' => 180, 'cost' => 150,
                'track_inventory' => true, 'stock_quantity' => 24, 'is_active' => true,
                'description' => 'Plain yogurt.', 'tax_rate' => 0,
            ] + $with)
            ->assertCreated()->json('data.id');

        return Product::withoutTenancy()->findOrFail($id);
    }

    public function test_a_packet_carded_with_a_batch_and_an_expiry_keeps_them(): void
    {
        $yogurt = $this->card(['opening_batch_number' => 'YG-OCT', 'expiry_date' => '2026-10-20']);

        $lot = ProductBatch::withoutTenancy()->where('product_id', $yogurt->id)->sole();
        $this->assertSame('YG-OCT', $lot->batch_number);
        $this->assertSame('2026-10-20', $lot->expiry_date->toDateString());
        $this->assertEquals(24, (float) $lot->quantity, 'the lot does not hold the opening stock');
    }

    public function test_an_expiry_alone_dates_the_opening_lot(): void
    {
        $yogurt = $this->card(['expiry_date' => '2026-10-20']);

        $lot = ProductBatch::withoutTenancy()->where('product_id', $yogurt->id)->sole();
        $this->assertSame('OPENING', $lot->batch_number);
        $this->assertSame('2026-10-20', $lot->expiry_date->toDateString());
    }

    public function test_a_packet_that_was_given_neither_has_no_lot(): void
    {
        $sugar = $this->card([]);

        $this->assertSame(0, ProductBatch::withoutTenancy()->where('product_id', $sugar->id)->count());
    }
}
