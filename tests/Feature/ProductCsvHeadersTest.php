<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\ProductCsv;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * The catalog file a shopkeeper actually opens.
 *
 * The export and the blank template shipped raw field names — `item_type`,
 * `plu_code`, `low_stock_threshold`. QA put it plainly: "in csv its showing
 * db/column name". That is the database talking to somebody pricing up their
 * shelves in Excel.
 *
 * The risk in fixing it is the ROUND TRIP. Export → edit → re-import is the
 * whole point of the feature, and a header renamed to something friendlier but
 * different would normalise to a field that does not exist and drop silently on
 * import — a worse bug than the one being fixed. So these tests pin the round
 * trip, not the prettiness.
 */
class ProductCsvHeadersTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);
        $this->tenant = Tenant::factory()->provisioned()->create();
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
    }

    private function login(): static
    {
        $this->defaultHeaders = [];
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    public function test_the_export_header_is_written_for_a_person(): void
    {
        Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product',
            'name' => 'Basmati Rice 5kg', 'sku' => 'R-1', 'price' => 2500,
        ]);

        $csv = $this->login()->get('/api/v1/products/export')->streamedContent();
        $header = str_getcsv(strtok($csv, "\n"));

        $this->assertContains('Item Type', $header);
        $this->assertContains('PLU Code', $header);
        $this->assertContains('Low Stock Threshold', $header);
        $this->assertNotContains('item_type', $header, 'the raw column name is still in the file');
        $this->assertNotContains('plu_code', $header);
    }

    public function test_the_blank_template_uses_the_same_header_as_the_export(): void
    {
        // Two lists drift. A template whose columns do not match the export is
        // a template that teaches the wrong shape.
        $export = str_getcsv(strtok($this->login()->get('/api/v1/products/export')->streamedContent(), "\n"));
        $template = str_getcsv(strtok($this->login()->get('/api/v1/products/import/template')->streamedContent(), "\n"));

        $this->assertSame($export, $template);
    }

    public function test_both_files_carry_the_utf8_marker_excel_needs(): void
    {
        // Without it Excel reads a file as Latin-1 and an Urdu product name
        // opens as mojibake. The template was hand-rolled and had no marker —
        // so the one file a merchant TYPES INTO was the one without it.
        foreach (['/api/v1/products/export', '/api/v1/products/import/template'] as $url) {
            $this->assertStringStartsWith(
                "\xEF\xBB\xBF",
                $this->login()->get($url)->streamedContent(),
                "{$url} is missing the UTF-8 BOM",
            );
        }
    }

    public function test_every_header_normalises_back_to_a_field_the_importer_knows(): void
    {
        // The guarantee the round trip rests on, asserted per column rather
        // than trusted. A header whose words were changed rather than merely
        // re-cased fails here.
        foreach (ProductCsv::HEADERS as $field => $header) {
            $this->assertSame(
                $field,
                ProductCsv::normalise($header),
                "the header \"{$header}\" no longer maps back to `{$field}` — re-importing an export would drop this column",
            );
        }
    }

    public function test_a_file_with_the_new_headers_imports(): void
    {
        // The end-to-end proof: pretty header in, product out.
        $csv = "Name,SKU,Price,Item Type,Low Stock Threshold\nDesi Ghee 1kg,G-1,1850,physical_product,5\n";

        $response = $this->login()->post('/api/v1/products/import', [
            'file' => UploadedFile::fake()->createWithContent('catalog.csv', $csv),
        ]);

        $response->assertOk();
        $this->assertDatabaseHas('products', [
            'tenant_id' => $this->tenant->id,
            'name' => 'Desi Ghee 1kg',
            'sku' => 'G-1',
            'low_stock_threshold' => 5,
        ]);
    }

    public function test_a_file_exported_before_this_change_still_imports(): void
    {
        // Back-compat. Somebody has a snake_case export sitting in Downloads,
        // and breaking it would be a regression they experience as data loss.
        $csv = "name,sku,price,item_type\nOld Format,O-1,300,physical_product\n";

        $this->login()->post('/api/v1/products/import', [
            'file' => UploadedFile::fake()->createWithContent('old.csv', $csv),
        ])->assertOk();

        $this->assertDatabaseHas('products', ['name' => 'Old Format', 'sku' => 'O-1']);
    }

    public function test_an_export_can_be_re_imported_unchanged(): void
    {
        // The full round trip, which is what the feature is FOR.
        Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product',
            'name' => 'Round Trip', 'sku' => 'RT-1', 'price' => 999, 'low_stock_threshold' => 7,
        ]);

        $exported = $this->login()->get('/api/v1/products/export')->streamedContent();

        $response = $this->login()->post('/api/v1/products/import', [
            'file' => UploadedFile::fake()->createWithContent('again.csv', $exported),
        ]);

        $response->assertOk();
        $this->assertSame(0, $response->json('data.failed'), 'a fresh export could not be read back in');
        // Matched on SKU and updated, not duplicated.
        $this->assertSame(1, Product::withoutTenancy()->where('sku', 'RT-1')->count());
    }
}
