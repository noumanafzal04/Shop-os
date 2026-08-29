<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Customer;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Permissions;
use App\Support\ProductCsv;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Bulk CSV export for products / customers / sales. Each endpoint is gated by
 * its resource permission, honours the matching list filters, and the product
 * export uses the SAME columns as the import template so a file round-trips.
 */
class BulkExportTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
            'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function csv(User $user, string $url): string
    {
        $response = $this->actingAsUser($user)->get($url);
        $response->assertOk();
        $response->assertHeader('content-type', 'text/csv; charset=UTF-8');

        return $response->streamedContent();
    }

    public function test_product_export_matches_the_import_template_columns(): void
    {
        Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Cooking Oil 1L', 'sku' => 'OIL-1L', 'price' => 620, 'cost' => 540,
            'stock_quantity' => 40, 'unit' => 'bottle',
        ]);

        $csv = $this->csv($this->owner, '/api/v1/products/export');
        $lines = array_values(array_filter(explode("\n", trim($csv))));

        // THE TEMPLATE IS NARROWER THAN THE EXPORT NOW, ON PURPOSE.
        //
        // These headers used to be asserted identical. They no longer are, and
        // the change is deliberate: an export is a BACKUP and must carry every
        // column a shop has, while the template is a blank a person fills in by
        // hand — and a restaurant handed `Dosage Form` and `Warranty Months` is
        // a restaurant being invited to make mistakes.
        //
        // What still has to hold is the direction that matters: everything the
        // template offers must be a column the export knows, so a file built
        // from the template can always be read back. A template column absent
        // from the export is a field the importer would silently drop.
        $template = $this->csv($this->owner, '/api/v1/products/import/template');
        $templateHeader = ltrim(explode("\n", trim($template))[0], "\xEF\xBB\xBF");
        $header = ltrim($lines[0], "\xEF\xBB\xBF");

        $templateCols = str_getcsv(trim($templateHeader));
        $exportCols = str_getcsv(trim($header));

        $this->assertSame(
            [],
            array_values(array_diff($templateCols, $exportCols)),
            'the template offers a column the export does not know',
        );
        // …and the narrowing is REAL. Without this the assertion above passes
        // against a template that has quietly become empty.
        $this->assertNotEmpty($templateCols);
        $this->assertLessThan(
            count($exportCols),
            count($templateCols),
            'the template was not narrowed for this trade at all',
        );

        // The columns each trade cannot bulk-load without. Asked of the FIELD
        // each header maps back to rather than of the header text, because the
        // headers are written for a person now ("Dosage Form") and what has to
        // hold is that they still normalise onto the fields the importer knows.
        $fields = array_map(
            fn (string $h): string => ProductCsv::normalise($h),
            str_getcsv($header),
        );
        foreach (['strength', 'dosage_form', 'kitchen_station', 'tracks_serial', 'duration_minutes'] as $column) {
            $this->assertContains($column, $fields, "the export can no longer carry `{$column}`");
        }
        $this->assertStringContainsString('Cooking Oil 1L', $csv);
        $this->assertStringContainsString('OIL-1L', $csv);
    }

    public function test_product_export_honours_the_search_filter(): void
    {
        Product::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product', 'name' => 'Basmati Rice', 'price' => 300]);
        Product::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product', 'name' => 'Cooking Oil', 'price' => 600]);

        $csv = $this->csv($this->owner, '/api/v1/products/export?search=rice');

        $this->assertStringContainsString('Basmati Rice', $csv);
        $this->assertStringNotContainsString('Cooking Oil', $csv);
    }

    public function test_customer_export_lists_the_directory(): void
    {
        Customer::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'name' => 'Ali Khan', 'phone' => '03001112233']);

        $csv = $this->csv($this->owner, '/api/v1/customers/export');

        $this->assertStringContainsString('Ali Khan', $csv);
        $this->assertStringContainsString('03001112233', $csv);
        $this->assertStringContainsString('credit_balance', $csv);
    }

    public function test_sales_export_honours_the_date_range(): void
    {
        $this->sale('INV-000001', '2026-07-10 10:00:00');
        $this->sale('INV-000002', '2026-06-01 10:00:00');

        $csv = $this->csv($this->owner, '/api/v1/sales/export?from=2026-07-01&to=2026-07-31');

        $this->assertStringContainsString('INV-000001', $csv);
        $this->assertStringNotContainsString('INV-000002', $csv);
    }

    public function test_export_is_gated_by_the_resource_permission(): void
    {
        // Staff with only customers.manage may export customers, not products.
        $staff = User::factory()->tenantStaff($this->tenant, [Permissions::CUSTOMERS_MANAGE])->create();

        $this->actingAsUser($staff)->get('/api/v1/products/export')->assertForbidden();
        $this->actingAsUser($staff)->get('/api/v1/customers/export')->assertOk();
    }

    private function sale(string $invoice, string $soldAt): Sale
    {
        return Sale::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            'invoice_number' => $invoice,
            'channel' => 'walk_in',
            'status' => 'completed',
            'subtotal' => 100, 'discount' => 0, 'tax' => 0, 'total' => 100,
            'payment_method' => 'cash', 'amount_paid' => 100, 'change_due' => 0,
            'sold_at' => $soldAt,
        ]);
    }
}
