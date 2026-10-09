<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\ProductUnit;
use App\Models\ProductVariant;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Spreadsheet\XlsxWriter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A SHOPKEEPER'S FILE, NOT A PROGRAMMER'S.
 *
 * Every import test until now typed `item_type` as a code on every row and
 * uploaded a clean UTF-8, comma-separated file. Nobody who runs a shop does
 * either. This is the file as it actually arrives: the type column left out,
 * prices with commas, a price list with three columns, Excel's own damage.
 */
class AnyShopImportsItsCatalogTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    private function shop(string $type, array $features = []): Tenant
    {
        return Tenant::factory()->create([
            'setup_completed' => true,
            'business_type' => $type,
            'features' => array_merge(BusinessTypes::defaultFeatures($type), $features),
        ]);
    }

    private function as(Tenant $shop): static
    {
        $owner = User::factory()->shopOwner($shop)->create();
        $token = $owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @param  array<string, mixed>  $with  dry_run, categories, mapping — as the form sends them */
    private function upload(Tenant $shop, string $body, string $name = 'products.csv', bool $flatten = true, array $with = []): TestResponse
    {
        $content = $flatten ? implode("\n", array_map('trim', explode("\n", trim($body)))) : $body;

        foreach (['categories', 'mapping'] as $json) {
            if (isset($with[$json])) {
                $with[$json] = json_encode($with[$json]);
            }
        }

        return $this->as($shop)->post('/api/v1/products/import', [
            'file' => UploadedFile::fake()->createWithContent($name, $content),
        ] + $with, ['Accept' => 'application/json']);
    }

    private function shelf(Tenant $shop, string $name, ?Category $under = null): Category
    {
        return Category::withoutTenancy()->create(['tenant_id' => $shop->id, 'name' => $name, 'parent_id' => $under?->id]);
    }

    private function template(Tenant $shop): string
    {
        return strtok(ltrim($this->as($shop)->get('/api/v1/products/import/template')->streamedContent(), "\xEF\xBB\xBF"), "\n");
    }

    private function item(string $sku): Product
    {
        return Product::withoutTenancy()->where('sku', $sku)->firstOrFail();
    }

    // ── the type column, left out ────────────────────────────────────

    public function test_a_salon_that_leaves_the_type_out_gets_services(): void
    {
        $this->upload($this->shop('services'), <<<'CSV'
        name,sku,price
        Gents Haircut,CUT-1,800
        CSV)->assertOk()->assertJsonPath('data.created', 1)->assertJsonPath('data.failed', 0);

        $this->assertSame('service', $this->item('CUT-1')->item_type);
    }

    public function test_a_restaurant_that_leaves_the_type_out_gets_dishes(): void
    {
        $this->upload($this->shop('food'), <<<'CSV'
        name,sku,price
        Chicken Karahi,KAR-1,1400
        CSV)->assertOk()->assertJsonPath('data.created', 1);

        $this->assertSame('food_item', $this->item('KAR-1')->item_type);
    }

    public function test_a_chemist_that_leaves_the_type_out_gets_medicines(): void
    {
        $this->upload($this->shop('pharmacy'), <<<'CSV'
        name,sku,price
        Panadol 500mg,PAN-1,35
        CSV)->assertOk()->assertJsonPath('data.created', 1);

        $this->assertSame('medicine', $this->item('PAN-1')->item_type);
    }

    public function test_the_type_is_understood_as_it_is_written_on_the_screen(): void
    {
        $this->upload($this->shop('pharmacy'), <<<'CSV'
        name,item type,sku,price
        Panadol 500mg,Medicine,PAN-1,35
        Thermometer,Physical Product,THERM-1,650
        CSV)->assertOk()->assertJsonPath('data.created', 2);

        $this->assertSame('medicine', $this->item('PAN-1')->item_type);
        $this->assertSame('physical_product', $this->item('THERM-1')->item_type);
    }

    // ── a price list is not a catalogue ──────────────────────────────

    public function test_a_price_list_changes_prices_and_nothing_it_did_not_mention(): void
    {
        // Selling online too, so "Visible In Marketplace" is a column it has.
        $shop = $this->shop('pharmacy', ['marketplace' => true]);
        $this->upload($shop, <<<'CSV'
        name,item_type,sku,price,requires_prescription,is_active,visible_in_marketplace
        Alprazolam 0.5mg,medicine,ALP-1,250,1,0,0
        CSV)->assertOk()->assertJsonPath('data.created', 1);

        // The supplier's new prices: three columns.
        $this->upload($shop, <<<'CSV'
        name,sku,price
        Alprazolam 0.5mg,ALP-1,275
        CSV)->assertOk()->assertJsonPath('data.updated', 1);

        $drug = $this->item('ALP-1');
        $this->assertEquals(275, $drug->price);
        $this->assertTrue((bool) $drug->requires_prescription, 'a price list switched off the prescription rule on a controlled drug');
        $this->assertFalse((bool) $drug->is_active, 'a price list put a discontinued item back on sale');
        $this->assertFalse((bool) $drug->visible_in_marketplace, 'a price list published a hidden item online');
    }

    // ── what Excel does to a file ────────────────────────────────────

    public function test_a_price_typed_the_way_people_write_money(): void
    {
        $this->upload($this->shop('mart'), <<<'CSV'
        name,sku,price,cost
        Cooking Oil 5L,OIL-5,"2,850","Rs 2,500.50"
        CSV)->assertOk()->assertJsonPath('data.created', 1);

        $this->assertEquals(2850, $this->item('OIL-5')->price);
        $this->assertEquals(2500.50, $this->item('OIL-5')->cost);
    }

    public function test_a_barcode_excel_turned_into_a_sum_is_said_not_saved(): void
    {
        $this->upload($this->shop('mart'), <<<'CSV'
        name,sku,price,barcode
        Super Biscuit,BIS-1,50,8.96123E+12
        CSV)->assertOk()
            ->assertJsonPath('data.failed', 1)
            ->assertJsonPath('data.errors.0.row', 2);

        $this->assertSame(0, Product::withoutTenancy()->where('sku', 'BIS-1')->count());
    }

    public function test_a_file_separated_by_semicolons(): void
    {
        $this->upload($this->shop('mart'), <<<'CSV'
        name;sku;price
        Sugar 1kg;SUG-1;180
        CSV)->assertOk()->assertJsonPath('data.created', 1);

        $this->assertEquals(180, $this->item('SUG-1')->price);
    }

    public function test_a_description_with_a_line_break_in_it_is_one_row(): void
    {
        $this->upload($this->shop('mart'), "name,sku,price,description\nSoap,SOAP-1,120,\"Lemon.\nPack of one.\"\nSugar,SUG-1,180,Loose\n", flatten: false)
            ->assertOk()->assertJsonPath('data.created', 2)->assertJsonPath('data.failed', 0);

        $this->assertSame("Lemon.\nPack of one.", $this->item('SOAP-1')->description);
    }

    public function test_a_file_saved_by_windows_excel_keeps_its_names(): void
    {
        // "Café Crème" as Windows-1252, which is what "CSV (Comma delimited)" writes.
        $body = "name,sku,price\n".mb_convert_encoding('Café Crème', 'Windows-1252', 'UTF-8').",CAF-1,450\n";

        $this->upload($this->shop('mart'), $body, flatten: false)->assertOk()->assertJsonPath('data.created', 1);

        $this->assertSame('Café Crème', $this->item('CAF-1')->name);
    }

    // ── the template is this shop's own ──────────────────────────────

    public function test_a_shop_under_an_old_trade_name_still_gets_its_trade_columns(): void
    {
        $header = $this->template($this->shop('clinic'));

        $this->assertStringContainsString('Generic Name', $header);
        $this->assertStringContainsString('Drug Schedule', $header);
    }

    public function test_a_shop_is_given_the_columns_its_modules_use_and_no_others(): void
    {
        // A baker selling online: no till, no stock count.
        $baker = $this->template($this->shop('online'));
        foreach (['Barcode', 'PLU Code', 'Wholesale Price', 'Stock Quantity', 'Pack Size'] as $notTheirs) {
            $this->assertStringNotContainsString($notTheirs, $baker, "a shop with no till or stock count was given {$notTheirs}");
        }
        $this->assertStringContainsString('Visible In Marketplace', $baker);

        // A grocer who sells nothing online.
        $grocer = $this->template($this->shop('mart', ['marketplace' => false]));
        $this->assertStringNotContainsString('Visible In Marketplace', $grocer);
        $this->assertStringContainsString('Stock Quantity', $grocer);
        $this->assertStringContainsString('Pack Size', $grocer);

        // A salon: one kind of item, and nothing on a shelf.
        $salon = $this->template($this->shop('services'));
        foreach (['Item Type', 'Stock Quantity', 'Brand', 'Barcode', 'Parent SKU'] as $notTheirs) {
            $this->assertStringNotContainsString($notTheirs, $salon, "a salon was given {$notTheirs}");
        }
        $this->assertStringContainsString('Duration Minutes', $salon);
    }

    public function test_a_column_the_shop_does_not_use_is_left_out_and_said(): void
    {
        $res = $this->upload($this->shop('services'), <<<'CSV'
        name,sku,price,stock_quantity,barcode
        Gents Haircut,CUT-1,800,25,8961234567890
        CSV)->assertOk()->assertJsonPath('data.created', 1)->json('data');

        $ignored = collect($res['ignored_columns'])->pluck('reason', 'header');
        $this->assertSame('your shop does not use the Inventory module', $ignored['stock_quantity']);
        $this->assertSame('your shop does not use the till', $ignored['barcode']);
        $this->assertNull($this->item('CUT-1')->barcode);
    }

    // ── a category is found, asked about, or left — never made up ────

    public function test_a_category_is_found_by_its_path_not_by_the_first_of_its_name(): void
    {
        $shop = $this->shop('mart');
        $electronic = $this->shelf($shop, 'Accessories', $this->shelf($shop, 'Electronics'));
        $hardware = $this->shelf($shop, 'Accessories', $this->shelf($shop, 'Hardware'));

        $res = $this->upload($shop, <<<'CSV'
        name,sku,price,category
        Phone Case,CASE-1,500,Hardware > Accessories
        Cable,CAB-1,300,electronics>accessories
        Loose Thing,LOO-1,100,Accessories
        CSV)->assertOk()->assertJsonPath('data.created', 2)->assertJsonPath('data.failed', 1)->json('data');

        $this->assertSame($hardware->id, $this->item('CASE-1')->category_id);
        $this->assertSame($electronic->id, $this->item('CAB-1')->category_id);
        // On two shelves, and the file did not say which.
        $this->assertSame(4, $res['errors'][0]['row']);
        $this->assertStringContainsString('more than one shelf', $res['errors'][0]['messages'][0]);
        $this->assertStringContainsString('Electronics > Accessories', $res['errors'][0]['messages'][0]);
    }

    public function test_a_name_on_one_shelf_only_needs_no_path(): void
    {
        $shop = $this->shop('mart');
        $drinks = $this->shelf($shop, 'Beverages', $this->shelf($shop, 'Grocery'));

        $this->upload($shop, <<<'CSV'
        name,sku,price,category
        Cola 1.5L,COLA-1,220,beverages
        CSV)->assertOk()->assertJsonPath('data.created', 1);

        $this->assertSame($drinks->id, $this->item('COLA-1')->category_id);
    }

    public function test_a_category_is_never_made_from_a_typing_mistake(): void
    {
        $shop = $this->shop('mart');
        $this->shelf($shop, 'Beverages');

        $res = $this->upload($shop, <<<'CSV'
        name,sku,price,category
        Cola 1.5L,COLA-1,220,Bevrages
        CSV)->assertOk()->assertJsonPath('data.created', 0)->assertJsonPath('data.failed', 1)->json('data');

        $this->assertStringContainsString('Did you mean "Beverages"?', $res['errors'][0]['messages'][0]);
        $this->assertSame(1, Category::withoutTenancy()->where('tenant_id', $shop->id)->count(), 'a typing mistake became a category');
    }

    public function test_the_preview_names_the_categories_it_does_not_know_and_saves_nothing(): void
    {
        $shop = $this->shop('mart');
        $drinks = $this->shelf($shop, 'Beverages');

        $res = $this->upload($shop, <<<'CSV'
        name,sku,price,category
        Cola 1.5L,COLA-1,220,Bevrages
        Lemon Soda,LEM-1,180,Bevrages
        Mineral Water,WAT-1,90,Beverages
        CSV, with: ['dry_run' => 1])->assertOk()->json('data');

        $this->assertTrue($res['dry_run']);
        $this->assertSame(1, $res['created']);
        $this->assertSame(2, $res['waiting']);
        $this->assertSame(0, $res['failed']);
        $this->assertSame(
            [['name' => 'Bevrages', 'rows' => 2, 'suggestion' => ['id' => $drinks->id, 'path' => 'Beverages']]],
            $res['unknown_categories'],
        );
        // …and it was a preview.
        $this->assertSame(0, Product::withoutTenancy()->where('tenant_id', $shop->id)->count());
        $this->assertSame(0, AuditLog::query()->where('tenant_id', $shop->id)->where('event', 'imported')->count());
    }

    public function test_an_unknown_category_is_made_only_when_somebody_says_so(): void
    {
        $shop = $this->shop('mart');

        $this->upload($shop, <<<'CSV'
        name,sku,price,category
        Salted Chips,CHIP-1,60,Snacks > Chips
        CSV, with: ['categories' => [['name' => 'Snacks > Chips', 'action' => 'create']]])
            ->assertOk()->assertJsonPath('data.created', 1);

        $snacks = Category::withoutTenancy()->where('tenant_id', $shop->id)->where('name', 'Snacks')->firstOrFail();
        $chips = Category::withoutTenancy()->where('tenant_id', $shop->id)->where('name', 'Chips')->firstOrFail();
        $this->assertNull($snacks->parent_id);
        $this->assertSame($snacks->id, $chips->parent_id);
        $this->assertSame($chips->id, $this->item('CHIP-1')->category_id);
    }

    public function test_an_unknown_category_can_be_pointed_at_one_the_shop_has(): void
    {
        $shop = $this->shop('mart');
        $drinks = $this->shelf($shop, 'Beverages');

        $this->upload($shop, <<<'CSV'
        name,sku,price,category
        Cola 1.5L,COLA-1,220,Bevrages
        CSV, with: ['categories' => [['name' => 'Bevrages', 'action' => 'map', 'id' => $drinks->id]]])
            ->assertOk()->assertJsonPath('data.created', 1);

        $this->assertSame($drinks->id, $this->item('COLA-1')->category_id);
        $this->assertSame(1, Category::withoutTenancy()->where('tenant_id', $shop->id)->count());
    }

    public function test_rows_under_a_category_somebody_chose_to_leave_are_left(): void
    {
        $shop = $this->shop('mart');

        $this->upload($shop, <<<'CSV'
        name,sku,price,category
        Old Stock,OLD-1,10,Discontinued
        Sugar 1kg,SUG-1,180,
        CSV, with: ['categories' => [['name' => 'Discontinued', 'action' => 'skip']]])
            ->assertOk()->assertJsonPath('data.skipped', 1)->assertJsonPath('data.created', 1)->assertJsonPath('data.failed', 0);

        $this->assertSame(0, Product::withoutTenancy()->where('sku', 'OLD-1')->count());
    }

    public function test_another_shops_category_cannot_be_pointed_at(): void
    {
        $shop = $this->shop('mart');
        $theirs = $this->shelf($this->shop('mart'), 'Beverages');

        $this->upload($shop, <<<'CSV'
        name,sku,price,category
        Cola 1.5L,COLA-1,220,Bevrages
        CSV, with: ['categories' => [['name' => 'Bevrages', 'action' => 'map', 'id' => $theirs->id]]])
            ->assertOk()->assertJsonPath('data.created', 0)->assertJsonPath('data.failed', 1);

        $this->assertSame(0, Product::withoutTenancy()->where('category_id', $theirs->id)->count());
    }

    // ── the preview is the import, undone ────────────────────────────

    public function test_what_the_preview_says_is_what_the_import_does(): void
    {
        $shop = $this->shop('mart');
        $file = <<<'CSV'
        name,sku,price,barcode
        Sugar 1kg,SUG-1,180,111
        Salt 800g,SALT-1,60,111
        Flour 5kg,FLR-1,abc,
        CSV;

        $preview = $this->upload($shop, $file, with: ['dry_run' => 1])->assertOk()->json('data');
        $this->assertSame(0, Product::withoutTenancy()->where('tenant_id', $shop->id)->count());

        $real = $this->upload($shop, $file)->assertOk()->json('data');

        foreach (['total', 'created', 'updated', 'failed', 'skipped', 'errors'] as $figure) {
            $this->assertSame($preview[$figure], $real[$figure], "the preview and the import disagree about {$figure}");
        }
        $this->assertSame(1, $real['created']);
        $this->assertSame(2, $real['failed']); // the second 111, and a price that is not a number
    }

    // ── a refused row comes back as it was sent ──────────────────────

    public function test_a_refused_row_is_handed_back_as_it_was_sent(): void
    {
        $res = $this->upload($this->shop('mart'), <<<'CSV'
        Name,SKU,Price,Notes
        Flour 5kg,FLR-1,abc,from the old shop
        CSV)->assertOk()->json('data');

        $this->assertSame(['Name', 'SKU', 'Price', 'Notes'], $res['headers']);
        $this->assertSame(
            [['row' => 2, 'status' => 'failed', 'messages' => ['Price "abc" is not a number.'], 'cells' => ['Name' => 'Flour 5kg', 'SKU' => 'FLR-1', 'Price' => 'abc', 'Notes' => 'from the old shop']]],
            $res['failed_rows'],
        );
    }

    public function test_the_columns_a_handed_back_file_carries_are_not_read_as_data(): void
    {
        // The corrected file comes back with the two columns we added to it.
        $res = $this->upload($this->shop('mart'), <<<'CSV'
        Name,SKU,Price,_import_status,_error_message
        Flour 5kg,FLR-1,640,failed,Price "abc" is not a number.
        CSV)->assertOk()->assertJsonPath('data.created', 1)->json('data');

        $this->assertSame([], $res['ignored_columns']);
        $this->assertSame(['Name', 'SKU', 'Price'], $res['headers']);
    }

    // ── a file from another system ───────────────────────────────────

    public function test_headings_from_another_system_are_understood(): void
    {
        $this->upload($this->shop('mart'), <<<'CSV'
        Item Name,Product Code,Selling Price,Purchase Price,Qty
        Sugar 1kg,SUG-1,180,165,40
        CSV)->assertOk()->assertJsonPath('data.created', 1)->assertJsonPath('data.ignored_columns', []);

        $sugar = $this->item('SUG-1');
        $this->assertSame('Sugar 1kg', $sugar->name);
        $this->assertEquals(180, $sugar->price);
        $this->assertEquals(165, $sugar->cost);
        $this->assertEquals(40, $sugar->stock_quantity);
    }

    public function test_a_refusal_names_the_column_as_the_file_calls_it(): void
    {
        // The person will look for "Selling Price" in their sheet. There is no
        // column called "Price" in it.
        $res = $this->upload($this->shop('mart'), <<<'CSV'
        Item Name,Product Code,Selling Price,Qty
        Sugar 1kg,SUG-1,abc,lots
        CSV)->assertOk()->json('data');

        $this->assertSame(
            // …and a price that could not be read is not ALSO "missing".
            ['Selling Price "abc" is not a number.', 'Qty "lots" is not a number.'],
            $res['errors'][0]['messages'],
        );
    }

    public function test_a_price_left_blank_is_missing_by_the_files_own_name_for_it(): void
    {
        $res = $this->upload($this->shop('mart'), <<<'CSV'
        Item Name,Product Code,Selling Price
        Sugar 1kg,SUG-1,
        CSV)->assertOk()->json('data');

        $this->assertSame(['Selling Price is missing.'], $res['errors'][0]['messages']);
    }

    public function test_a_heading_nobody_knows_is_asked_about_and_then_obeyed(): void
    {
        $shop = $this->shop('mart');
        $file = <<<'CSV'
        name,sku,price,Company
        Sugar 1kg,SUG-1,180,Al-Noor Mills
        CSV;

        $preview = $this->upload($shop, $file, with: ['dry_run' => 1])->assertOk()->json('data');
        $this->assertSame([['header' => 'Company', 'reason' => 'it is not a column this import knows', 'unknown' => true]], $preview['ignored_columns']);
        // What it may be said to be: this shop's own columns.
        $this->assertSame('Brand', $preview['fields']['brand']);

        $this->upload($shop, $file, with: ['mapping' => ['Company' => 'brand']])->assertOk()->assertJsonPath('data.created', 1);
        $this->assertSame('Al-Noor Mills', $this->item('SUG-1')->brand);
    }

    // ── nothing is invented ──────────────────────────────────────────

    public function test_a_deal_is_not_something_a_row_can_be(): void
    {
        $res = $this->upload($this->shop('mart'), <<<'CSV'
        name,item type,sku,price
        Ramadan Box,Combo / Deal,DEAL-1,2500
        CSV)->assertOk()->assertJsonPath('data.failed', 1)->json('data');

        $this->assertStringContainsString('Products screen', $res['errors'][0]['messages'][0]);
    }

    public function test_a_kind_the_shop_does_not_keep_is_said_by_its_name(): void
    {
        $res = $this->upload($this->shop('mart'), <<<'CSV'
        name,item type,sku,price
        Panadol,Medicine,PAN-1,35
        CSV)->assertOk()->assertJsonPath('data.failed', 1)->json('data');

        $this->assertSame(['Your shop does not keep items of the kind "Medicine".'], $res['errors'][0]['messages']);
    }

    public function test_an_item_added_again_under_the_same_name_is_counted(): void
    {
        $shop = $this->shop('mart');
        $file = "name,price\nSoap,120\n";

        $this->upload($shop, $file, flatten: false)->assertOk()->assertJsonPath('data.created', 1)->assertJsonPath('data.same_name', 0);
        // The same file again. With no SKU there is nothing to match on.
        $this->upload($shop, $file, flatten: false)->assertOk()->assertJsonPath('data.created', 1)->assertJsonPath('data.same_name', 1);
    }

    public function test_a_stock_figure_for_an_item_that_counts_none_is_said_not_refused(): void
    {
        $shop = $this->shop('mart');
        $this->upload($shop, <<<'CSV'
        name,sku,price,track_inventory
        Shopping Bag,BAG-1,10,No
        CSV)->assertOk()->assertJsonPath('data.created', 1);

        $res = $this->upload($shop, <<<'CSV'
        name,sku,price,stock_quantity
        Shopping Bag,BAG-1,15,500
        CSV)->assertOk()->assertJsonPath('data.updated', 1)->assertJsonPath('data.failed', 0)->json('data');

        $this->assertSame([['row' => 2, 'messages' => ['"Shopping Bag" does not count stock, so its Stock Quantity was left alone.']]], $res['warnings']);
        $this->assertEquals(15, $this->item('BAG-1')->price);
        $this->assertEquals(0, $this->item('BAG-1')->stock_quantity);
    }

    // ── a chemist's first lot ────────────────────────────────────────

    public function test_a_medicine_arriving_with_stock_needs_its_expiry(): void
    {
        $res = $this->upload($this->shop('pharmacy'), <<<'CSV'
        name,sku,price,stock_quantity
        Panadol 500mg,PAN-1,35,100
        CSV)->assertOk()->assertJsonPath('data.failed', 1)->json('data');

        $this->assertStringContainsString('Expiry Date', $res['errors'][0]['messages'][0]);
        $this->assertSame(0, Product::withoutTenancy()->where('sku', 'PAN-1')->count());
    }

    public function test_a_medicines_first_lot_is_dated_and_numbered_from_the_sheet(): void
    {
        $this->upload($this->shop('pharmacy'), <<<'CSV'
        name,sku,price,stock quantity,expiry date,batch number
        Panadol 500mg,PAN-1,35,100,03/2027,B-77
        CSV)->assertOk()->assertJsonPath('data.created', 1);

        $lot = ProductBatch::withoutTenancy()->where('product_id', $this->item('PAN-1')->id)->firstOrFail();
        $this->assertSame('B-77', $lot->batch_number);
        // "03/2027" on a strip is good until the last day of March.
        $this->assertSame('2027-03-31', $lot->expiry_date->toDateString());
        $this->assertEquals(100, $lot->quantity);
    }

    // ── Excel ────────────────────────────────────────────────────────

    public function test_an_excel_workbook_is_a_file(): void
    {
        $shop = $this->shop('mart');
        $bytes = (new XlsxWriter)->sheet('Products', [
            ['Name', 'SKU', 'Barcode', 'Price', 'Stock Quantity'],
            ['Super Biscuit 100g', 'BIS-1', 8961234567890, 50, 240],
            ['Daily Milk 1L', '00417', '', 300, 12],
        ])->bytes();

        $res = $this->as($shop)->post('/api/v1/products/import', [
            'file' => UploadedFile::fake()->createWithContent('products.xlsx', $bytes),
        ], ['Accept' => 'application/json'])->assertOk()->json('data');

        $this->assertSame('xlsx', $res['kind']);
        $this->assertSame(2, $res['created']);
        // A number to Excel, an identity to the shop.
        $this->assertSame('8961234567890', $this->item('BIS-1')->barcode);
        $this->assertEquals(12, $this->item('00417')->stock_quantity);
    }

    public function test_the_excel_template_is_this_shops_own_and_comes_back_in(): void
    {
        $shop = $this->shop('pharmacy');
        $this->shelf($shop, 'Tablets', $this->shelf($shop, 'Medicines'));

        $res = $this->as($shop)->get('/api/v1/products/import/template?format=xlsx');
        $res->assertOk();
        $this->assertStringContainsString('spreadsheetml', (string) $res->headers->get('content-type'));

        $back = $this->as($shop)->post('/api/v1/products/import', [
            'file' => UploadedFile::fake()->createWithContent('template.xlsx', $res->getContent()),
        ], ['Accept' => 'application/json'])->assertOk()->json('data');

        $this->assertSame(0, $back['failed'], 'a chemist\'s own Excel template was refused: '.json_encode($back['errors']));
        $this->assertGreaterThan(0, $back['created']);
        // The example sits on one of the shop's own shelves, not a made-up one.
        $this->assertSame([], $back['unknown_categories']);
    }

    // ── a carton of 24 ───────────────────────────────────────────────

    public function test_a_carton_is_a_row_under_the_item_it_is_a_carton_of(): void
    {
        $shop = $this->shop('mart');

        $this->upload($shop, <<<'CSV'
        name,sku,parent sku,pack size,barcode,price,stock quantity
        Carton,,BIS-1,24,890000000002,1080,
        Super Biscuit 100g,BIS-1,,,8961234567890,50,240
        CSV)->assertOk()->assertJsonPath('data.created', 2)->assertJsonPath('data.failed', 0);

        $biscuit = $this->item('BIS-1');
        $carton = ProductUnit::withoutTenancy()->where('product_id', $biscuit->id)->firstOrFail();

        $this->assertSame('Carton', $carton->name);
        $this->assertEquals(24, $carton->factor);
        $this->assertEquals(1080, $carton->price);
        $this->assertSame('890000000002', $carton->barcode);
        // One pool of stock, in pieces: a pack is a way of selling it.
        $this->assertEquals(240, $biscuit->stock_quantity);
        $this->assertSame(1, Product::withoutTenancy()->where('tenant_id', $shop->id)->count());
    }

    public function test_a_file_that_mentions_one_pack_does_not_retire_the_others(): void
    {
        $shop = $this->shop('pharmacy');
        $this->upload($shop, <<<'CSV'
        name,sku,parent sku,pack size,price
        Panadol 500mg,PAN-1,,,3.5
        Strip,,PAN-1,10,35
        Box,,PAN-1,100,330
        CSV)->assertOk()->assertJsonPath('data.created', 3);

        $this->upload($shop, <<<'CSV'
        name,parent sku,pack size,price
        Box,PAN-1,100,345
        CSV)->assertOk()->assertJsonPath('data.updated', 1);

        $packs = ProductUnit::withoutTenancy()->where('product_id', $this->item('PAN-1')->id)->pluck('price', 'name');
        $this->assertEquals(35, $packs['Strip']);
        $this->assertEquals(345, $packs['Box']);
    }

    public function test_a_pack_of_one_is_not_a_pack(): void
    {
        $shop = $this->shop('mart');

        $res = $this->upload($shop, <<<'CSV'
        name,sku,parent sku,pack size,price
        Soap,SOAP-1,,,120
        Single,,SOAP-1,1,120
        Dozen,,SOAP-1,12,1300
        CSV)->assertOk()->assertJsonPath('data.created', 2)->assertJsonPath('data.failed', 1)->json('data');

        // The one bad pack is refused on its own row — and the good pack of
        // the same item is not refused along with it.
        $this->assertSame(3, $res['errors'][0]['row']);
        $this->assertSame(['Pack Size is how many it holds, so it is more than 1.'], $res['errors'][0]['messages']);
        $this->assertSame(['Dozen'], ProductUnit::withoutTenancy()->pluck('name')->all());
    }

    // ── what goes out comes back ─────────────────────────────────────

    public function test_what_is_exported_comes_back_in_with_its_sizes_and_packs(): void
    {
        // "Shirts" is on TWO shelves. An export that wrote the name alone
        // could not be sent back: the import would not know which.
        $from = $this->shop('retail');
        $this->shelf($from, 'Shirts', $this->shelf($from, 'Garments'));
        $this->shelf($from, 'Shirts', $this->shelf($from, 'Uniforms'));

        $this->upload($from, <<<'CSV'
        name,sku,parent sku,pack size,category,price,stock quantity
        T-Shirt,TSHIRT,,,Garments > Shirts,900,0
        Small,TSHIRT-S,TSHIRT,,,900,20
        Large,TSHIRT-L,TSHIRT,,,1000,15
        Dozen,,TSHIRT,12,,9600,
        CSV)->assertOk()->assertJsonPath('data.created', 4)->assertJsonPath('data.failed', 0);

        $exported = $this->as($from)->get('/api/v1/products/export')->streamedContent();

        // Into a second shop of the same trade, that has the same shelves.
        $to = $this->shop('retail');
        $shirts = $this->shelf($to, 'Shirts', $this->shelf($to, 'Garments'));
        $this->shelf($to, 'Shirts', $this->shelf($to, 'Uniforms'));

        $this->upload($to, $exported, flatten: false)
            ->assertOk()->assertJsonPath('data.failed', 0)->assertJsonPath('data.created', 4);

        $shirt = Product::withoutTenancy()->where('tenant_id', $to->id)->where('sku', 'TSHIRT')->firstOrFail();
        $this->assertSame($shirts->id, $shirt->category_id);
        $this->assertEqualsCanonicalizing(
            [['Small', '900.00', '20.000'], ['Large', '1000.00', '15.000']],
            ProductVariant::withoutTenancy()->where('product_id', $shirt->id)->get()->map(fn ($v) => [$v->name, (string) $v->price, (string) $v->stock_quantity])->all(),
        );
        $dozen = ProductUnit::withoutTenancy()->where('product_id', $shirt->id)->firstOrFail();
        $this->assertEquals(12, $dozen->factor);
        $this->assertEquals(9600, $dozen->price);

        // …and sent back to the shop it came from, it changes nothing and adds nothing.
        $this->upload($from, $exported, flatten: false)
            ->assertOk()->assertJsonPath('data.failed', 0)->assertJsonPath('data.created', 0)->assertJsonPath('data.updated', 4);
        $this->assertSame(1, Product::withoutTenancy()->where('tenant_id', $from->id)->count());
    }
}
