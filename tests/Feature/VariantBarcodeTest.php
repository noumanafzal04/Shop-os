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

    public function test_generating_codes_gives_every_size_its_own_and_a_scan_rings_that_size(): void
    {
        // Labels → Generate barcodes. A clothing shop prints a ticket per size;
        // one code for the whole item made every scan stop and ask which size.
        $product = $this->drink([
            ['name' => '500ml', 'price' => 80, 'stock_quantity' => 10],
            ['name' => '1L', 'price' => 140, 'stock_quantity' => 10],
        ]);

        $this->login()->postJson("/api/v1/products/{$product['id']}/barcode")->assertOk();

        $codes = ProductBarcode::query()->where('product_id', $product['id'])->whereNotNull('variant_id')
            ->pluck('barcode', 'variant_id');
        $this->assertCount(2, $codes, 'a size was left without a code of its own');
        $this->assertCount(2, $codes->unique(), 'two sizes were given the same code');
        foreach ($codes as $code) {
            $this->assertMatchesRegularExpression('/^\d{12}$/', $code);
        }

        $big = collect($product['variants'])->firstWhere('name', '1L');
        $res = $this->login()->getJson('/api/v1/pos/lookup?code='.$codes[$big['id']])->assertOk();
        $this->assertSame($big['id'], $res->json('data.variant_id'),
            'the generated code did not ring the size it was printed for');
    }

    public function test_generating_again_keeps_the_codes_already_printed(): void
    {
        // A size that already carries a code (its packet's EAN, or a ticket
        // printed last week) keeps it; only the size without one gets a new code.
        $product = $this->drink([
            ['name' => '500ml', 'price' => 80, 'barcode' => '8961000000015', 'stock_quantity' => 10],
            ['name' => '1L', 'price' => 140, 'stock_quantity' => 10],
        ]);
        $small = collect($product['variants'])->firstWhere('name', '500ml');
        $big = collect($product['variants'])->firstWhere('name', '1L');

        $this->login()->postJson("/api/v1/products/{$product['id']}/barcode")->assertOk();
        $first = ProductBarcode::query()->where('variant_id', $big['id'])->value('barcode');

        $this->login()->postJson("/api/v1/products/{$product['id']}/barcode")->assertOk();

        $this->assertSame('8961000000015', ProductBarcode::query()->where('variant_id', $small['id'])->value('barcode'),
            "the size's own printed code was replaced");
        $this->assertNotNull($first);
        $this->assertSame([$first], ProductBarcode::query()->where('variant_id', $big['id'])->pluck('barcode')->all(),
            'a second press made the size another code instead of keeping the one on its ticket');
    }

    public function test_an_item_with_one_code_for_all_its_sizes_is_left_as_it_chose(): void
    {
        // "One for all sizes": the item's code on every label, the till asks
        // which size. Labels' Generate must not hand each size a code anyway.
        $res = $this->login()->postJson('/api/v1/products', [
            'name' => 'Polo', 'item_type' => 'physical_product', 'price' => 1500,
            'barcode' => '8961000000091', 'track_inventory' => true,
            'variants' => [
                ['name' => 'S', 'price' => 1500, 'stock_quantity' => 5],
                ['name' => 'M', 'price' => 1500, 'stock_quantity' => 5],
            ],
        ])->assertCreated();
        $id = $res->json('data.id');

        $this->login()->postJson("/api/v1/products/{$id}/barcode")->assertOk();

        $this->assertSame(0, ProductBarcode::query()->where('product_id', $id)->whereNotNull('variant_id')->count(),
            'the sizes were given codes of their own though the shop chose one for all');
        $this->assertSame('8961000000091', Product::query()->whereKey($id)->value('barcode'));

        // And the shared code still rings the item, leaving the size to be asked.
        $lookup = $this->login()->getJson('/api/v1/pos/lookup?code=8961000000091')->assertOk();
        $this->assertSame($id, $lookup->json('data.product.id'));
        $this->assertNull($lookup->json('data.variant_id'), 'one shared code picked a size by itself');
    }

    public function test_the_forms_generate_button_gets_codes_that_save_on_sizes_and_ring_them(): void
    {
        // The product form's Generate: codes for sizes that do not exist yet,
        // typed into their boxes, saved with the item.
        $codes = $this->login()->postJson('/api/v1/barcodes/fresh', ['count' => 3])
            ->assertOk()->json('data.codes');

        $this->assertCount(3, $codes);
        $this->assertCount(3, array_unique($codes), 'one batch handed out the same code twice');
        foreach ($codes as $code) {
            $this->assertMatchesRegularExpression('/^\d{12}$/', $code);
        }

        $product = $this->drink([
            ['name' => '500ml', 'price' => 80, 'barcode' => $codes[0], 'stock_quantity' => 10],
            ['name' => '1L', 'price' => 140, 'barcode' => $codes[1], 'stock_quantity' => 10],
        ]);

        $big = collect($product['variants'])->firstWhere('name', '1L');
        $res = $this->login()->getJson('/api/v1/pos/lookup?code='.$codes[1])->assertOk();
        $this->assertSame($big['id'], $res->json('data.variant_id'), 'a generated code did not ring its size');
    }

    public function test_fresh_codes_are_never_one_the_shop_already_uses(): void
    {
        // Drawn from the same well as Labels' Generate, which checks every place
        // a scan is answered from. Asked for many, none may already be taken.
        $taken = $this->login()->postJson('/api/v1/barcodes/fresh', ['count' => 1])->json('data.codes.0');
        $this->login()->postJson('/api/v1/products', [
            'name' => 'Water', 'item_type' => 'physical_product', 'price' => 50, 'barcode' => $taken,
        ])->assertCreated();

        $codes = $this->login()->postJson('/api/v1/barcodes/fresh', ['count' => 100])->assertOk()->json('data.codes');
        $this->assertNotContains($taken, $codes);

        $this->login()->postJson('/api/v1/barcodes/fresh', ['count' => 0])->assertStatus(422);
        $this->login()->postJson('/api/v1/barcodes/fresh', ['count' => 101])->assertStatus(422);
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
