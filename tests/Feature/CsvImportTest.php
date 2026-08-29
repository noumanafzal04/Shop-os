<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class CsvImportTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'grocery', 'features' => BusinessTypes::defaultFeatures('grocery'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function upload(string $csv)
    {
        return $this->actingAsUser($this->owner)->post('/api/v1/products/import', [
            'file' => UploadedFile::fake()->createWithContent('products.csv', $csv),
        ], ['Accept' => 'application/json']);
    }

    public function test_valid_rows_create_products_and_bad_rows_are_reported(): void
    {
        $csv = <<<'CSV'
        name,item_type,sku,price,category,stock_quantity,barcodes
        Widget A,physical_product,W-A,100,General,10,
        Widget B,physical_product,W-B,200,General,5,111|222
        Broken Row,physical_product,BRK,,General,3,
        CSV;

        $res = $this->upload($csv)->assertOk()->json('data');

        $this->assertSame(3, $res['total']);
        $this->assertSame(2, $res['created']);
        $this->assertSame(1, $res['failed']);
        $this->assertSame(4, $res['errors'][0]['row']); // header=1, rows 2,3,4 → the 3rd data row
        $this->assertEqualsCanonicalizing(['W-A', 'W-B'],
            Product::withoutTenancy()->where('tenant_id', $this->shop->id)->pluck('sku')->all());
        $this->assertSame(2, ProductBarcode::withoutTenancy()
            ->whereIn('barcode', ['111', '222'])->count());
    }

    public function test_import_upserts_by_sku(): void
    {
        $this->upload("name,item_type,sku,price\nGhee 1kg,physical_product,GHEE-1,900")->assertOk();
        $this->assertSame('900.00', Product::withoutTenancy()->where('sku', 'GHEE-1')->first()->price);

        // Same SKU again with a new price → UPDATE, not a duplicate.
        $res = $this->upload("name,item_type,sku,price\nGhee 1kg,physical_product,GHEE-1,950")
            ->assertOk()->json('data');

        $this->assertSame(1, $res['updated']);
        $this->assertSame(0, $res['created']);
        $this->assertSame(1, Product::withoutTenancy()->where('sku', 'GHEE-1')->count());
        $this->assertSame('950.00', Product::withoutTenancy()->where('sku', 'GHEE-1')->first()->price);
    }

    public function test_missing_required_header_is_rejected(): void
    {
        $this->upload("name,sku\nNo Price Column,X-1")
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'IMPORT_BAD_HEADER');
    }

    public function test_import_requires_products_permission(): void
    {
        $staff = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create();
        $this->actingAsUser($staff)->post('/api/v1/products/import', [
            'file' => UploadedFile::fake()->createWithContent('p.csv', "name,price\nX,10"),
        ], ['Accept' => 'application/json'])->assertStatus(403);
    }

    public function test_template_downloads_with_headers(): void
    {
        $res = $this->actingAsUser($this->owner)->get('/api/v1/products/import/template');
        $res->assertOk();
        $this->assertStringContainsString('text/csv', $res->headers->get('content-type'));
        // Headers written for a shopkeeper opening this in Excel, not the
        // column names of the products table. The importer lowercases and
        // swaps spaces for underscores, so these still read back in —
        // ProductCsvHeadersTest pins that round trip per column.
        $this->assertStringContainsString('Name,"Item Type",SKU', $res->streamedContent());
    }

    /**
     * SIZES, IN THE SAME FILE AS THEIR PRODUCTS.
     *
     * A product with sizes could not be bulk-loaded at all: there was no
     * variant column, so a garment shop imported five hundred shirts and then
     * added every Small, Medium and Large by hand, one screen at a time.
     */
    public function test_a_size_is_a_row_that_names_its_parent_by_sku(): void
    {
        $csv = <<<'CSV'
        name,item_type,sku,parent_sku,price,category,stock_quantity
        T-Shirt,physical_product,TSHIRT,,900,Garments,0
        Small,,TSHIRT-S,TSHIRT,900,,20
        Large,,TSHIRT-L,TSHIRT,1000,,15
        CSV;

        $res = $this->upload($csv)->assertOk()->json('data');

        $this->assertSame(0, $res['failed'], json_encode($res['errors']));

        $shirt = Product::withoutTenancy()->where('sku', 'TSHIRT')->firstOrFail();
        $sizes = $shirt->variants()->orderBy('name')->get();

        $this->assertSame(['Large', 'Small'], $sizes->pluck('name')->all());
        $this->assertSame('1000.00', (string) $sizes->firstWhere('name', 'Large')->price);
        $this->assertSame('TSHIRT-S', $sizes->firstWhere('name', 'Small')->sku);
    }

    public function test_a_size_can_arrive_before_the_product_it_belongs_to(): void
    {
        // A merchant sorting the sheet by name puts "Large" above "T-Shirt".
        // One pass would refuse it for a reason invisible in the file, and the
        // fix would be "re-sort your spreadsheet".
        $csv = <<<'CSV'
        name,item_type,sku,parent_sku,price,category,stock_quantity
        Large,,TSHIRT-L,TSHIRT,1000,,15
        T-Shirt,physical_product,TSHIRT,,900,Garments,0
        CSV;

        $res = $this->upload($csv)->assertOk()->json('data');

        $this->assertSame(0, $res['failed'], json_encode($res['errors']));
        $this->assertSame(1, Product::withoutTenancy()->where('sku', 'TSHIRT')->firstOrFail()->variants()->count());
    }

    public function test_a_partial_file_never_retires_a_size_it_did_not_mention(): void
    {
        // SyncProductVariantsAction retires whatever is missing from the list
        // it is given — right for the edit screen, catastrophic here. A
        // merchant correcting the price of Large only would otherwise retire
        // Small, silently, and find out when the till refused to sell it.
        $this->upload(<<<'CSV'
        name,item_type,sku,parent_sku,price,category,stock_quantity
        T-Shirt,physical_product,TSHIRT,,900,Garments,0
        Small,,TSHIRT-S,TSHIRT,900,,20
        Large,,TSHIRT-L,TSHIRT,1000,,15
        CSV)->assertOk();

        $this->upload(<<<'CSV'
        name,sku,parent_sku,price
        Large,TSHIRT-L,TSHIRT,1200
        CSV)->assertOk();

        $shirt = Product::withoutTenancy()->where('sku', 'TSHIRT')->firstOrFail();
        $sizes = $shirt->variants()->orderBy('name')->get();

        $this->assertSame(['Large', 'Small'], $sizes->pluck('name')->all(), 'a partial import retired a size');
        $this->assertSame('1200.00', (string) $sizes->firstWhere('name', 'Large')->price);
    }

    public function test_a_size_whose_parent_does_not_exist_is_refused_by_name(): void
    {
        $res = $this->upload(<<<'CSV'
        name,sku,parent_sku,price
        Large,GHOST-L,NO-SUCH-SKU,1000
        CSV)->assertOk()->json('data');

        $this->assertSame(1, $res['failed']);
        $this->assertStringContainsString('NO-SUCH-SKU', $res['errors'][0]['messages'][0]);
    }
}
