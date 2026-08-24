<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE CODE PRINTED ON THIS SIZE'S OWN PACKET.
 *
 * A drinks shop puts a different EAN on the 500ml and the 1L. A chemist's strip
 * and box each carry their own. A garment's size tickets differ. That is the
 * entire reason those codes are printed — and the till has read
 * `product_barcodes.variant_id` to resolve a scan to ONE size since the column
 * existed.
 *
 * Nothing ever wrote it. Every alternate barcode was created with
 * `['tenant_id', 'barcode']` and no variant, so all of them belonged to the
 * parent. Scanning the 1L's own code found the parent product and the till then
 * asked which size — while holding the answer in its hand.
 *
 * A reader with no writer, which is this repository's most repeated defect.
 */
class VariantBarcodeTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function login(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** A bottled drink in two sizes, each with the EAN from its own label. */
    private function drink(array $variants): array
    {
        $res = $this->login()->postJson('/api/v1/products', [
            'name' => 'Cola', 'item_type' => 'physical_product', 'price' => 80,
            'track_inventory' => true, 'variants' => $variants,
        ])->assertCreated();

        return $res->json('data');
    }

    public function test_each_size_keeps_the_code_from_its_own_label(): void
    {
        $product = $this->drink([
            ['name' => '500ml', 'price' => 80, 'barcode' => '8961000000015', 'stock_quantity' => 10],
            ['name' => '1L', 'price' => 140, 'barcode' => '8961000000022', 'stock_quantity' => 10],
        ]);

        $rows = ProductBarcode::query()->where('product_id', $product['id'])->get();

        $this->assertCount(2, $rows, 'the sizes were saved with no codes of their own');
        $this->assertNotNull($rows->firstWhere('barcode', '8961000000022')->variant_id,
            'the code was filed against the PARENT — which is what made the till ask '
            .'which size while holding the answer');
    }

    public function test_scanning_a_size_rings_that_size(): void
    {
        $product = $this->drink([
            ['name' => '500ml', 'price' => 80, 'barcode' => '8961000000015', 'stock_quantity' => 10],
            ['name' => '1L', 'price' => 140, 'barcode' => '8961000000022', 'stock_quantity' => 10],
        ]);

        $res = $this->login()->getJson('/api/v1/pos/lookup?code=8961000000022')->assertOk();

        $big = collect($product['variants'])->firstWhere('name', '1L');
        $this->assertSame($product['id'], $res->json('data.product.id'));
        $this->assertSame($big['id'], $res->json('data.variant_id'),
            'the scan resolved to the product and left the size to be asked for');
    }

    public function test_clearing_the_box_takes_the_code_off(): void
    {
        // A shop that empties the field has said the packet no longer carries it.
        $product = $this->drink([
            ['name' => '500ml', 'price' => 80, 'barcode' => '8961000000015', 'stock_quantity' => 10],
        ]);
        $variant = $product['variants'][0];

        $this->login()->putJson("/api/v1/products/{$product['id']}", [
            'name' => 'Cola', 'price' => 80,
            'variants' => [['id' => $variant['id'], 'name' => '500ml', 'price' => 80, 'barcode' => '']],
        ])->assertOk();

        $this->assertSame(0, ProductBarcode::query()->where('variant_id', $variant['id'])->count());
    }

    public function test_two_sizes_cannot_share_one_code(): void
    {
        // One code, one thing on the shelf. Otherwise the scan lookup rings
        // whichever namespace it reaches first, silently.
        $this->login()->postJson('/api/v1/products', [
            'name' => 'Cola', 'item_type' => 'physical_product', 'price' => 80,
            'track_inventory' => true,
            'variants' => [
                ['name' => '500ml', 'price' => 80, 'barcode' => '8961000000015'],
                ['name' => '1L', 'price' => 140, 'barcode' => '8961000000015'],
            ],
        ])->assertStatus(422);
    }

    public function test_a_size_cannot_take_another_product_s_code(): void
    {
        $other = $this->login()->postJson('/api/v1/products', [
            'name' => 'Water', 'item_type' => 'physical_product', 'price' => 50,
            'barcode' => '8961000000039',
        ])->assertCreated();
        $this->assertNotNull($other->json('data.id'));

        $this->login()->postJson('/api/v1/products', [
            'name' => 'Cola', 'item_type' => 'physical_product', 'price' => 80,
            'track_inventory' => true,
            'variants' => [['name' => '500ml', 'price' => 80, 'barcode' => '8961000000039']],
        ])->assertStatus(422);
    }

    public function test_editing_the_alternates_does_not_wipe_the_sizes_codes(): void
    {
        // `barcodes()` is every row for the product, and a size's code is one of
        // them. Replacing the alternates used to delete the lot.
        $product = $this->drink([
            ['name' => '500ml', 'price' => 80, 'barcode' => '8961000000015', 'stock_quantity' => 10],
        ]);
        $variant = $product['variants'][0];

        $this->login()->putJson("/api/v1/products/{$product['id']}", [
            'name' => 'Cola', 'price' => 80, 'barcodes' => ['8961000000046'],
        ])->assertOk();

        $this->assertSame(1, ProductBarcode::query()->where('variant_id', $variant['id'])->count(),
            "editing the shop's alternate codes wiped every size's own code");
    }
}
