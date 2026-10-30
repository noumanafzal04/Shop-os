<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Tenant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

/**
 * #VS1 — `loadtest:audit` said 423 of 425 and exited 1 on a healthy fixture.
 *
 * Both failures were "some rows have two axes, not one (0 of 0 are colour and
 * size)", on two shops with no sized product at all. The grid section ran for
 * any product whose `attributes` was not null — and a product with no sizes
 * can still carry attributes. A check about an empty set reported a
 * disagreement, so the one command meant to answer "do the figures add up?"
 * cried wolf, and the next person learns to ignore its exit code.
 */
class AnAuditOfNothingIsNotAFailureTest extends TestCase
{
    use RefreshDatabase;

    private function audit(Tenant $shop): string
    {
        Artisan::call('loadtest:audit', ['--shop' => substr($shop->slug, strlen('loadtest-'))]);

        return Artisan::output();
    }

    private function shop(): Tenant
    {
        return Tenant::factory()->create(['slug' => 'loadtest-vs1', 'business_name' => 'VS1 Pharmacy', 'setup_completed' => true]);
    }

    public function test_a_shop_with_no_sizes_is_not_audited_for_its_sizes(): void
    {
        $shop = $this->shop();
        Product::query()->create([
            'tenant_id' => $shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Panadol', 'price' => 30, 'track_inventory' => false, 'is_active' => true,
            'attributes' => ['strength' => '500 mg'],
        ]);

        $out = $this->audit($shop);

        $this->assertStringContainsString('VS1 Pharmacy', $out, 'the audit never reached the shop');
        $this->assertStringNotContainsString('two axes', $out);
        $this->assertStringNotContainsString('every combination of colour and size', $out);
    }

    public function test_a_shop_with_a_colour_and_size_grid_is_still_audited(): void
    {
        $shop = $this->shop();
        $kurti = Product::query()->create([
            'tenant_id' => $shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Lawn Kurti', 'price' => 2500, 'track_inventory' => true, 'is_active' => true,
            'attributes' => ['variant_axes' => [
                ['name' => 'Colour', 'values' => ['Red']],
                ['name' => 'Size', 'values' => ['S', 'M']],
            ]],
        ]);
        foreach (['S', 'M'] as $size) {
            ProductVariant::query()->create([
                'tenant_id' => $shop->id, 'product_id' => $kurti->id,
                'name' => "Red / {$size}", 'sku' => "KRT-R-{$size}", 'price' => 2500, 'stock_quantity' => 3,
            ]);
        }

        $out = $this->audit($shop);

        $this->assertStringContainsString('· every combination of colour and size exists  (1 grids, 2 combinations)', $out);
        $this->assertStringContainsString('· some rows have two axes, not one  (2 of 2 are colour and size)', $out);
    }
}
