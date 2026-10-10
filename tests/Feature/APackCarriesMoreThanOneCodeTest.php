<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\ProductUnit;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\PosProjection;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A PACK CARRIES MORE THAN ONE CODE — AND STAYS THE SAME PACK.
 *
 * A carton of biscuits: 24 pieces at Rs 50, the carton at Rs 1,080. It has the
 * maker's outer code on it, and a distributor's sticker with another.
 *
 *   The second code had one place to go — the item's "other barcodes", every
 *   one of which means ONE PIECE. Scanned, the carton rang a single: Rs 50
 *   for Rs 1,080 of biscuits, with nothing on the screen to say so.
 *
 *   And every save of the item gave its packs new ids, whatever had changed.
 *   A till, a tablet offline or a quotation holding the old id was then told
 *   "a pack unit in this sale is no longer available" — about a carton that
 *   had been on the shelf the whole time.
 */
class APackCarriesMoreThanOneCodeTest extends TestCase
{
    use RefreshDatabase;

    private const PIECE = '8961230000011';

    private const CARTON = '8961230000028';

    private const STICKER = '8961230000059';

    private const OLD_ART = '8961230000066';

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    // ── what a scan rings ───────────────────────────────────────────

    public function test_any_code_printed_on_the_carton_rings_the_carton(): void
    {
        $biscuits = $this->biscuits();
        $carton = $this->pack($biscuits, 'Carton');

        foreach ([self::CARTON, self::STICKER, self::OLD_ART] as $code) {
            $this->scan($code)->assertOk()
                ->assertJsonPath('data.product.id', $biscuits['id'])
                ->assertJsonPath('data.product_unit_id', $carton);
        }

        // The piece's own code is still a piece.
        $this->scan(self::PIECE)->assertOk()->assertJsonPath('data.product_unit_id', null);
    }

    public function test_and_it_is_sold_as_twenty_four_at_the_cartons_price(): void
    {
        $biscuits = $this->biscuits();
        $scanned = $this->scan(self::STICKER)->assertOk()->json('data');

        $sale = $this->as()->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 2000,
            'items' => [['product_id' => $scanned['product']['id'], 'product_unit_id' => $scanned['product_unit_id'], 'quantity' => 1]],
        ])->assertCreated()->json('data');

        // Rs 1,080 — not the Rs 50 the same scan used to ring.
        $this->assertSame('1080.00', $sale['total']);
        $this->assertSame('Carton', $sale['items'][0]['unit_name']);
        $this->assertEquals(240 - 24, Product::withoutTenancy()->find($biscuits['id'])->stock_quantity);
    }

    public function test_the_items_own_other_codes_still_mean_one_piece(): void
    {
        $biscuits = $this->biscuits(['barcodes' => ['PIECE-OLD-LABEL']]);

        $this->scan('PIECE-OLD-LABEL')->assertOk()
            ->assertJsonPath('data.product.id', $biscuits['id'])
            ->assertJsonPath('data.product_unit_id', null);
    }

    // ── one code, one thing ─────────────────────────────────────────

    public function test_a_code_cannot_be_the_piece_and_the_pack(): void
    {
        $this->biscuits();

        // The item's own barcode, said again as one of its carton's.
        $this->saveBiscuits(['units' => [$this->carton([self::PIECE])]])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'BARCODE_TAKEN')
            ->assertJsonPath('message', 'Barcode '.self::PIECE." is this item's own barcode — that one means a single piece.");
    }

    public function test_nor_one_of_the_items_other_codes(): void
    {
        $this->biscuits(['barcodes' => ['PIECE-OLD-LABEL']]);

        $this->saveBiscuits(['barcodes' => ['PIECE-OLD-LABEL'], 'units' => [$this->carton(['PIECE-OLD-LABEL'])]])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'BARCODE_TAKEN');

        // And the other way about: a carton's code offered as a piece's.
        $this->saveBiscuits(['barcodes' => [self::STICKER]])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'BARCODE_TAKEN');
    }

    public function test_nor_anything_else_in_the_shop(): void
    {
        $this->biscuits();
        $soap = $this->as()->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'Soap', 'price' => 120, 'barcode' => 'SOAP-1',
            'barcodes' => ['SOAP-ALT'],
            'units' => [['name' => 'Dozen', 'factor' => 12, 'barcode' => 'SOAP-DOZEN', 'barcodes' => ['SOAP-DOZEN-2']]],
        ])->assertCreated()->json('data');

        // Another item's barcode, its other code, its pack's first code, its pack's second.
        foreach (['SOAP-1', 'SOAP-ALT', 'SOAP-DOZEN', 'SOAP-DOZEN-2'] as $taken) {
            $this->saveBiscuits(['units' => [$this->carton([$taken])]])
                ->assertStatus(422)->assertJsonPath('meta.error_code', 'BARCODE_TAKEN');
        }

        // Nothing was half-saved by the refusals.
        $this->assertSame([self::STICKER, self::OLD_ART], $this->codesOf('Carton'));
        $this->assertSame(['SOAP-DOZEN-2'], ProductBarcode::withoutTenancy()->where('product_id', $soap['id'])->whereNotNull('product_unit_id')->pluck('barcode')->all());
    }

    public function test_nor_the_code_of_one_size_of_something(): void
    {
        $this->biscuits();
        $this->as()->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'Cola', 'price' => 100,
            'variants' => [
                ['name' => '500 ml', 'sku' => 'COLA-500', 'price' => 100],
                ['name' => '1 Litre', 'sku' => 'COLA-1L', 'price' => 180, 'barcode' => 'COLA-1L-EAN'],
            ],
        ])->assertCreated();

        // A size's SKU and a size's own barcode both answer a scan already.
        foreach (['COLA-500', 'COLA-1L-EAN'] as $taken) {
            $this->saveBiscuits(['units' => [$this->carton([$taken])]])
                ->assertStatus(422)->assertJsonPath('meta.error_code', 'BARCODE_TAKEN');
        }
    }

    public function test_two_packs_of_one_item_cannot_share_a_code(): void
    {
        $this->biscuits();

        $this->saveBiscuits(['units' => [
            $this->carton(['SHARED']),
            ['name' => 'Case', 'factor' => 48, 'price' => 2100, 'barcode' => 'CASE-1', 'barcodes' => ['SHARED']],
        ]])->assertStatus(422)->assertJsonPath('message', 'Barcode SHARED is on two packs of this item. A code means one pack.');

        // Nor may one pack's FIRST code be another's second.
        $this->saveBiscuits(['units' => [
            $this->carton([]),
            ['name' => 'Case', 'factor' => 48, 'barcode' => 'CASE-1', 'barcodes' => [self::CARTON]],
        ]])->assertStatus(422)->assertJsonPath('meta.error_code', 'BARCODE_TAKEN');
    }

    public function test_two_packs_swap_a_code_in_one_save(): void
    {
        $this->biscuits();
        $this->saveBiscuits(['units' => [
            $this->carton([self::STICKER, self::OLD_ART]),
            ['name' => 'Case', 'factor' => 48, 'price' => 2100, 'barcode' => 'CASE-1', 'barcodes' => ['CASE-2']],
        ]])->assertOk();

        // The sticker goes to the Case and the Case's code comes to the Carton,
        // at once. Whichever pack is written first is taking a code the other
        // still holds — so every pack lets go of its codes BEFORE any is checked.
        $this->saveBiscuits(['units' => [
            $this->carton(['CASE-2', self::OLD_ART]),
            ['name' => 'Case', 'factor' => 48, 'price' => 2100, 'barcode' => 'CASE-1', 'barcodes' => [self::STICKER]],
        ]])->assertOk();

        $this->assertSame(['CASE-2', self::OLD_ART], $this->codesOf('Carton'));
        $this->assertSame([self::STICKER], $this->codesOf('Case'));
        $this->scan(self::STICKER)->assertJsonPath('data.product_unit_id', $this->unit('Case')->id);
        $this->scan('CASE-2')->assertJsonPath('data.product_unit_id', $this->unit('Carton')->id);
    }

    public function test_a_packs_first_code_said_again_is_dropped_not_refused(): void
    {
        $this->biscuits();

        $this->saveBiscuits(['units' => [$this->carton([self::CARTON, ' '.self::STICKER.' ', self::STICKER, ''])]])->assertOk();

        $this->assertSame([self::STICKER], $this->codesOf('Carton'));
    }

    // ── a pack stays the same pack ──────────────────────────────────

    public function test_an_edit_that_does_not_touch_the_packs_leaves_their_ids_alone(): void
    {
        $biscuits = $this->biscuits();
        $carton = $this->pack($biscuits, 'Carton');

        // By its id, as the form sends it…
        $this->saveBiscuits(['description' => 'Now with more butter.', 'units' => [['id' => $carton] + $this->carton()]])->assertOk();
        $this->assertSame($carton, $this->unit('Carton')->id);

        // …and by its name, as the import and an older panel do.
        $this->saveBiscuits(['description' => 'Now with even more.', 'units' => [$this->carton()]])->assertOk();
        $this->assertSame($carton, $this->unit('Carton')->id);

        // Nothing was soft-deleted and written again behind it.
        $this->assertSame(1, ProductUnit::withoutTenancy()->withTrashed()->where('product_id', $biscuits['id'])->count());
    }

    public function test_a_renamed_pack_is_the_same_pack(): void
    {
        $biscuits = $this->biscuits();
        $carton = $this->pack($biscuits, 'Carton');

        $this->saveBiscuits(['units' => [['id' => $carton, 'name' => 'Outer', 'factor' => 24, 'price' => 1100, 'barcode' => self::CARTON]]])->assertOk();

        $outer = $this->unit('Outer');
        $this->assertSame($carton, $outer->id);
        $this->assertEquals(1100, $outer->price);
        // It kept its other codes: the edit said nothing about them.
        $this->assertSame([self::STICKER, self::OLD_ART], $this->codesOf('Outer'));
    }

    public function test_a_sale_holding_a_packs_id_survives_the_item_being_edited(): void
    {
        // The whole reason identity matters. A till put the carton in its cart;
        // the owner then corrected the item's description; the till pressed Pay.
        $biscuits = $this->biscuits();
        $held = $this->pack($biscuits, 'Carton');

        $this->saveBiscuits(['description' => 'A typo, corrected.', 'units' => [$this->carton()]])->assertOk();

        $this->as()->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 2000,
            'items' => [['product_id' => $biscuits['id'], 'product_unit_id' => $held, 'quantity' => 1]],
        ])->assertCreated()->assertJsonPath('data.total', '1080.00');
    }

    public function test_two_rows_of_one_name_are_two_packs_never_one_written_twice(): void
    {
        $biscuits = $this->biscuits();
        $carton = $this->pack($biscuits, 'Carton');

        // Nobody should name two packs alike, and nothing stops them. The
        // first is the carton that was there; the second must be a NEW pack —
        // matched to the same one, it would be written over and one would vanish.
        $this->saveBiscuits(['units' => [
            $this->carton(),
            ['name' => 'carton', 'factor' => 48, 'price' => 2100],
        ]])->assertOk();

        $packs = ProductUnit::withoutTenancy()->where('product_id', $biscuits['id'])->orderBy('factor')->get();
        $this->assertCount(2, $packs);
        $this->assertSame($carton, $packs[0]->id);
        $this->assertEquals(24, $packs[0]->factor);
        $this->assertEquals(48, $packs[1]->factor);
    }

    public function test_an_id_from_another_item_is_not_a_way_in(): void
    {
        $this->biscuits();
        $soap = $this->as()->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'Soap', 'price' => 120,
            'units' => [['name' => 'Dozen', 'factor' => 12, 'price' => 1300]],
        ])->assertCreated()->json('data');
        $dozen = $soap['units'][0]['id'];

        // The soap's pack id, sent on a biscuit's row: a new pack, not a stolen one.
        $this->saveBiscuits(['units' => [$this->carton(), ['id' => $dozen, 'name' => 'Tray', 'factor' => 6]]])->assertOk();

        $this->assertNotSame($dozen, $this->unit('Tray')->id);
        $this->assertSame('Dozen', ProductUnit::withoutTenancy()->find($dozen)->name);
        $this->assertSame($soap['id'], ProductUnit::withoutTenancy()->find($dozen)->product_id);
    }

    // ── saying, and not saying ──────────────────────────────────────

    public function test_a_caller_that_says_nothing_of_the_codes_leaves_them(): void
    {
        $this->biscuits();

        // No `barcodes` key on the pack at all — the import, an older panel.
        $this->saveBiscuits(['units' => [['name' => 'Carton', 'factor' => 24, 'price' => 1090, 'barcode' => self::CARTON]]])->assertOk();

        $this->assertSame([self::STICKER, self::OLD_ART], $this->codesOf('Carton'));
        $this->assertEquals(1090, $this->unit('Carton')->price);
    }

    public function test_an_empty_list_takes_them_all_off(): void
    {
        $this->biscuits();

        $this->saveBiscuits(['units' => [$this->carton([])]])->assertOk();

        $this->assertSame([], $this->codesOf('Carton'));
        // Off the carton, the code is nobody's.
        $this->scan(self::STICKER)->assertStatus(422)->assertJsonPath('meta.error_code', 'POS_ITEM_NOT_FOUND');
    }

    public function test_editing_the_items_own_other_codes_does_not_wipe_a_packs(): void
    {
        $this->biscuits();

        // Only `barcodes` is sent: the piece's alternates, replaced wholesale.
        $this->saveBiscuits(['barcodes' => ['PIECE-NEW-LABEL']])->assertOk();

        $this->assertSame([self::STICKER, self::OLD_ART], $this->codesOf('Carton'));
        $this->scan(self::STICKER)->assertJsonPath('data.product_unit_id', $this->unit('Carton')->id);
        $this->scan('PIECE-NEW-LABEL')->assertJsonPath('data.product_unit_id', null);
    }

    public function test_a_pack_that_is_removed_gives_its_codes_back(): void
    {
        $biscuits = $this->biscuits();

        $this->saveBiscuits(['units' => []])->assertOk();

        // The pack itself is gone from the item…
        $this->assertSame([], $this->as()->getJson("/api/v1/products/{$biscuits['id']}")->json('data.units'));
        $this->scan(self::CARTON)->assertStatus(422)->assertJsonPath('meta.error_code', 'POS_ITEM_NOT_FOUND');
        // …and so is every other code that was on it.
        $this->assertSame(0, ProductBarcode::withoutTenancy()->where('product_id', $biscuits['id'])->whereNotNull('product_unit_id')->count());
        $this->scan(self::STICKER)->assertStatus(422);

        // Free for something else to carry.
        $this->as()->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'Rusk', 'price' => 90, 'barcode' => self::STICKER,
        ])->assertCreated();
    }

    public function test_an_item_that_is_deleted_gives_every_one_of_its_codes_back(): void
    {
        $biscuits = $this->biscuits(['barcodes' => ['PIECE-OLD-LABEL']]);

        $this->as()->deleteJson("/api/v1/products/{$biscuits['id']}")->assertSuccessful();

        // Carded again, exactly as it was: the piece's code, its other code,
        // the carton's first code and both of its others. Every one of them
        // used to be "already used by another product" — a product that was
        // nowhere left to take them off.
        $again = $this->biscuits(['barcodes' => ['PIECE-OLD-LABEL']]);

        $this->assertNotSame($biscuits['id'], $again['id']);
        $this->scan(self::STICKER)->assertOk()
            ->assertJsonPath('data.product.id', $again['id'])
            ->assertJsonPath('data.product_unit_id', $this->pack($again, 'Carton'));
        $this->scan('PIECE-OLD-LABEL')->assertOk()->assertJsonPath('data.product.id', $again['id']);
        $this->scan(self::CARTON)->assertOk()->assertJsonPath('data.product.id', $again['id']);
    }

    // ── what the form and the till are sent ─────────────────────────

    public function test_the_form_is_given_each_packs_codes(): void
    {
        $biscuits = $this->biscuits();

        $units = $this->as()->getJson("/api/v1/products/{$biscuits['id']}")->assertOk()->json('data.units');

        $this->assertCount(1, $units);
        $this->assertSame([self::STICKER, self::OLD_ART], array_column($units[0]['codes'], 'barcode'));
        // And the item's OWN other codes do not include a pack's.
        $this->assertSame([], collect($this->as()->getJson("/api/v1/products/{$biscuits['id']}")->json('data.barcodes'))
            ->whereNull('variant_id')->whereNull('product_unit_id')->pluck('barcode')->all());
    }

    public function test_a_till_is_told_which_codes_are_a_packs(): void
    {
        $biscuits = $this->biscuits(['barcodes' => ['PIECE-OLD-LABEL']]);
        $carton = $this->pack($biscuits, 'Carton');

        $row = PosProjection::item(
            Product::withoutTenancy()->with(PosProjection::RELATIONS)->find($biscuits['id']),
        );

        // The plain list is what an OLDER till reads as "one piece": a pack's
        // code must not be in it, or that till rings a carton for Rs 50.
        $this->assertSame(['PIECE-OLD-LABEL'], $row['barcodes']);
        $this->assertEqualsCanonicalizing([
            ['code' => self::STICKER, 'variant_id' => null, 'unit_id' => $carton],
            ['code' => self::OLD_ART, 'variant_id' => null, 'unit_id' => $carton],
        ], $row['codes']);
    }

    // ── a spreadsheet ───────────────────────────────────────────────

    public function test_a_file_gives_a_pack_its_other_codes(): void
    {
        $this->upload(<<<'CSV'
        name,sku,parent sku,pack size,barcode,barcodes,price,stock quantity
        Butter Biscuits,BIS-1,,,8961230000011,PIECE-OLD-LABEL,50,240
        Carton,,BIS-1,24,8961230000028,8961230000059|8961230000066,1080,
        CSV)->assertOk()->assertJsonPath('data.failed', 0)->assertJsonPath('data.created', 2);

        $this->assertSame([self::STICKER, self::OLD_ART], $this->codesOf('Carton'));
        // On the PACK's row they are the pack's; on the item's row, a piece's.
        $this->scan(self::OLD_ART)->assertJsonPath('data.product_unit_id', $this->unit('Carton')->id);
        $this->scan('PIECE-OLD-LABEL')->assertJsonPath('data.product_unit_id', null);
    }

    public function test_a_file_that_says_nothing_of_them_leaves_them(): void
    {
        $biscuits = $this->biscuits(['sku' => 'BIS-1']);
        $carton = $this->pack($biscuits, 'Carton');

        // A price list: the carton by name, and no code columns at all.
        $this->upload(<<<'CSV'
        name,parent sku,pack size,price
        Carton,BIS-1,24,1120
        CSV)->assertOk()->assertJsonPath('data.failed', 0)->assertJsonPath('data.updated', 1);

        $this->assertEquals(1120, $this->unit('Carton')->price);
        $this->assertSame([self::STICKER, self::OLD_ART], $this->codesOf('Carton'));
        // …and it is the same carton it was.
        $this->assertSame($carton, $this->unit('Carton')->id);
    }

    public function test_what_is_exported_puts_a_packs_codes_on_the_packs_row(): void
    {
        $this->biscuits(['sku' => 'BIS-1', 'barcodes' => ['PIECE-OLD-LABEL']]);

        $csv = ltrim($this->as()->get('/api/v1/products/export')->streamedContent(), "\xEF\xBB\xBF");
        $lines = array_map('str_getcsv', array_filter(explode("\n", trim($csv))));
        $head = array_map('strtolower', $lines[0]);
        $cell = fn (array $row, string $column) => $row[array_search($column, $head, true)] ?? null;
        $item = collect($lines)->first(fn ($row) => $cell($row, 'sku') === 'BIS-1');
        $pack = collect($lines)->first(fn ($row) => $cell($row, 'parent sku') === 'BIS-1');

        // A pack's code on the ITEM's row would come back in as a piece's.
        $this->assertSame('PIECE-OLD-LABEL', $cell($item, 'barcodes'));
        $this->assertSame(self::STICKER.'|'.self::OLD_ART, $cell($pack, 'barcodes'));
        $this->assertSame(self::CARTON, $cell($pack, 'barcode'));
    }

    // ── helpers ─────────────────────────────────────────────────────

    private function upload(string $body): TestResponse
    {
        $content = implode("\n", array_map('trim', explode("\n", trim($body))));

        return $this->as()->post('/api/v1/products/import', [
            'file' => UploadedFile::fake()->createWithContent('products.csv', $content),
        ], ['Accept' => 'application/json']);
    }

    /**
     * Biscuits: Rs 50 a piece, 240 on the shelf; a Carton of 24 at Rs 1,080
     * with the maker's code and two others.
     *
     * @param  array<string, mixed>  $with
     * @return array<string, mixed>
     */
    private function biscuits(array $with = []): array
    {
        return $this->as()->postJson('/api/v1/products', $with + [
            'item_type' => 'physical_product', 'name' => 'Butter Biscuits', 'price' => 50, 'barcode' => self::PIECE,
            'track_inventory' => true, 'stock_quantity' => 240,
            'units' => [$this->carton([self::STICKER, self::OLD_ART])],
        ])->assertCreated()->json('data');
    }

    /**
     * @param  list<string>|null  $others  null = say nothing about them
     * @return array<string, mixed>
     */
    private function carton(?array $others = null): array
    {
        return ['name' => 'Carton', 'factor' => 24, 'price' => 1080, 'barcode' => self::CARTON]
            + ($others === null ? [] : ['barcodes' => $others]);
    }

    /** @param array<string, mixed> $changes */
    private function saveBiscuits(array $changes): TestResponse
    {
        $id = Product::withoutTenancy()->where('name', 'Butter Biscuits')->value('id');

        return $this->as()->putJson("/api/v1/products/{$id}", $changes);
    }

    /** @param array<string, mixed> $product */
    private function pack(array $product, string $name): string
    {
        return collect($product['units'])->firstWhere('name', $name)['id'];
    }

    private function unit(string $name): ProductUnit
    {
        return ProductUnit::withoutTenancy()->where('name', $name)->firstOrFail();
    }

    /** @return list<string> */
    private function codesOf(string $pack): array
    {
        return $this->unit($pack)->codes()->withoutGlobalScopes()->pluck('barcode')->all();
    }

    private function scan(string $code): TestResponse
    {
        return $this->as()->getJson('/api/v1/pos/lookup?code='.urlencode($code));
    }

    private function as(): static
    {
        $this->defaultHeaders = [];
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
