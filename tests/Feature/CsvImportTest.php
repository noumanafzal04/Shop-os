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
        $this->assertStringContainsString('name,item_type,sku', $res->streamedContent());
    }
}
