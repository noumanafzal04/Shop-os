<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Product;
use App\Models\Register;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\ShopTime;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\File;
use Tests\TestCase;

/**
 * THE PAPER READS THE SHOP'S CLOCK.
 *
 * Found by the QA journey: a quotation written at 12:53 in the afternoon
 * printed "Date 06 Oct 2026, 07:53 AM". The receipt beside it said 07:47 AM
 * for a sale rung at 12:47. Every printed document formatted a UTC timestamp
 * as it stood, so every paper a shop in Pakistan handed over was five hours
 * early — and after midnight, a DAY early.
 *
 * The moments are fixed here on purpose. A test that used "now" would pass
 * for nineteen hours of every day and prove nothing about the other five.
 */
class ThePaperReadsTheShopsClockTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Register $lane;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'business_type' => 'mart', 'timezone' => 'Asia/Karachi',
            'features' => array_merge(BusinessTypes::defaultFeatures('mart'), ['documents' => true]),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $main = Branch::withoutTenancy()->where('tenant_id', $this->tenant->id)->where('is_default', true)->firstOrFail();
        $this->lane = Register::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $main->id, 'name' => 'Lane 1', 'is_active' => true,
        ]);
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Basmati Rice', 'price' => 950, 'stock_quantity' => 100, 'track_inventory' => true,
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token)->withHeader('X-Register-Id', $this->lane->id);
    }

    private function receiptRungAt(string $utc): string
    {
        Carbon::setTestNow(Carbon::parse($utc, 'UTC'));

        $sale = $this->as()->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1000,
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        return (string) $this->as()->get("/api/v1/sales/{$sale['id']}/invoice")->assertOk()->getContent();
    }

    public function test_a_sale_at_a_quarter_to_one_prints_a_quarter_to_one(): void
    {
        // 07:47 UTC is 12:47 in Lahore.
        $html = $this->receiptRungAt('2026-10-06 07:47:00');

        $this->assertStringContainsString('06 Oct 2026 · 12:47 PM', $html);
        $this->assertStringNotContainsString('07:47 AM', $html, 'the receipt printed the time in UTC');
    }

    public function test_a_sale_after_midnight_prints_the_day_it_was_made(): void
    {
        // 21:00 UTC on the 6th is 02:00 on the 7th in Lahore: the customer
        // was in the shop on the 7th, and that is the date on a return slip.
        $html = $this->receiptRungAt('2026-10-06 21:00:00');

        $this->assertStringContainsString('07 Oct 2026 · 02:00 AM', $html);
        $this->assertStringNotContainsString('06 Oct 2026', $html, 'the receipt is dated the day before the sale');
    }

    public function test_the_zone_is_the_shops_own_and_not_the_countrys(): void
    {
        $this->tenant->forceFill(['timezone' => 'Asia/Dubai'])->save();

        // 07:47 UTC is 11:47 in Dubai.
        $this->assertStringContainsString('06 Oct 2026 · 11:47 AM', $this->receiptRungAt('2026-10-06 07:47:00'));
    }

    public function test_a_quotation_is_dated_by_the_shops_clock_and_its_last_day_is_not_moved(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-10-06 21:30:00', 'UTC'));   // 02:30 on the 7th, locally

        $doc = $this->as()->postJson('/api/v1/sale-documents', [
            'kind' => 'quotation', 'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
            'expires_at' => '2026-10-20',
        ])->assertCreated()->json('data');

        $html = (string) $this->as()->get("/api/v1/sale-documents/{$doc['id']}/print")->assertOk()->getContent();

        $this->assertStringContainsString('07 Oct 2026, 02:30 AM', $html);
        // A calendar date is not a moment. The 20th is the 20th.
        $this->assertStringContainsString('20 Oct 2026', $html);
        $this->assertStringNotContainsString('19 Oct 2026', $html);
        $this->assertStringNotContainsString('21 Oct 2026', $html);
    }

    public function test_the_z_read_opens_and_closes_on_the_shops_clock(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-10-06 04:02:00', 'UTC'));   // 09:02 locally
        $this->as()->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])->assertSuccessful();

        Carbon::setTestNow(Carbon::parse('2026-10-06 16:15:00', 'UTC'));   // 21:15 locally
        $closed = $this->as()->postJson('/api/v1/pos/session/close', ['counted_cash' => 1000])->assertSuccessful()->json('data');

        $html = (string) $this->as()->get("/api/v1/pos/sessions/{$closed['id']}/z-report/print")->assertOk()->getContent();

        $this->assertStringContainsString('06 Oct 2026, 09:02', $html);
        $this->assertStringContainsString('06 Oct 2026, 21:15', $html);
        $this->assertStringNotContainsString('04:02', $html);
    }

    public function test_nothing_printed_formats_a_clock_time_on_its_own(): void
    {
        /*
         * Four templates each formatted a timestamp where it stood. A fifth
         * written tomorrow will do the same and look right to whoever wrote
         * it, because it reads right on a developer's machine in UTC+0 tests.
         *
         * So: no view may call ->format() with hours in it. A date alone is
         * allowed — see ShopTime for why a calendar date must not be moved.
         */
        $clocks = 0;
        $raw = [];
        foreach (File::allFiles(resource_path('views')) as $file) {
            foreach (explode("\n", $file->getContents()) as $n => $line) {
                $clocks += substr_count($line, 'ShopTime::show(');
                if (preg_match('/->format\(\s*[\'"][^\'"]*[hHgG]:i/', $line)) {
                    $raw[] = $file->getRelativePathname().':'.($n + 1);
                }
            }
        }

        // The receipt, the quotation, the Z-read and the kitchen ticket.
        $this->assertGreaterThanOrEqual(6, $clocks, 'the scan found fewer printed times than exist');
        $this->assertSame([], $raw, 'a printed time is formatted in UTC — use ShopTime::show()');
    }

    public function test_a_quotation_for_a_number_with_no_name_does_not_print_a_placeholder_as_one(): void
    {
        // Found on the same paper: "Customer   Customer · 0300…". A phone-only
        // customer is filed as "Customer", and that word is not their name.
        $doc = $this->as()->postJson('/api/v1/sale-documents', [
            'kind' => 'quotation', 'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
            'customer_phone' => '03001110009',
        ])->assertCreated()->json('data');

        $this->assertNull($doc['customer_name'], 'the placeholder was stored on the quotation as the customer\'s name');

        $html = (string) $this->as()->get("/api/v1/sale-documents/{$doc['id']}/print")->assertOk()->getContent();
        $this->assertStringContainsString('03001110009', $html);
        $this->assertDoesNotMatchRegularExpression('/>\s*Customer\s*<span class="soft">·/', $html);

        // A name that WAS given is kept, on a later quotation for the same number.
        $named = $this->as()->postJson('/api/v1/sale-documents', [
            'kind' => 'quotation', 'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
            'customer_phone' => '03001110009', 'customer_name' => 'Bilal Traders',
        ])->assertCreated()->json('data');
        $this->assertSame('Bilal Traders', $named['customer_name']);
    }

    public function test_the_sales_file_an_accountant_is_handed_is_on_the_shops_clock(): void
    {
        // The same fault, in a file instead of on a slip: `sold_at` was written
        // to the CSV as UTC, so the export disagreed with every receipt in it.
        Carbon::setTestNow(Carbon::parse('2026-10-06 21:00:00', 'UTC'));   // 02:00 on the 7th, locally

        $this->as()->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1000,
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated();

        $response = $this->as()->get('/api/v1/sales/export');
        $response->assertOk();
        $csv = $response->streamedContent();

        $this->assertStringContainsString('2026-10-07 02:00:00', $csv);
        $this->assertStringNotContainsString('2026-10-06 21:00:00', $csv, 'the sales export is in UTC');
        // …and the file is named for the shop's day, not the server's.
        $this->assertStringContainsString('sales-2026-10-07.csv', (string) $response->headers->get('content-disposition'));
    }

    public function test_a_moment_that_never_happened_prints_nothing(): void
    {
        $this->assertSame('', ShopTime::show(null, 'd M Y, H:i', $this->tenant));
        // A shop that has not said where it is, is in Pakistan — as its column defaults.
        $this->assertSame('Asia/Karachi', ShopTime::zone(new Tenant));
    }
}
