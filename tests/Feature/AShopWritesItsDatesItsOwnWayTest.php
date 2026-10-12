<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Product;
use App\Models\Register;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\DateFormats;
use App\Support\ShopTime;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\File;
use Tests\TestCase;

/**
 * A SHOP WRITES ITS DATES ITS OWN WAY — on every paper.
 *
 *     "date ka format setting main hona chahye — for international?"
 *
 * The papers wrote "06 Oct 2026" for everybody and the screens wrote whatever
 * the browser liked. A shop now chooses one way (Settings → Business → Dates)
 * and its receipt, quotation, table bill, Z-read and kitchen slip are all
 * written that way — the same day, at the same clock time, in the shop's own
 * zone as before. A machine's file is left a machine's.
 *
 * One sale is rung on the 6th of October, at a quarter to one, in Lahore: a
 * day that reads as the tenth of June the other way round, which is the whole
 * reason for the setting.
 */
class AShopWritesItsDatesItsOwnWayTest extends TestCase
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

    private function writeDatesAs(string $code): void
    {
        $this->as()->putJson('/api/v1/shop/settings', ['date_format' => $code])->assertOk()->assertJsonPath('data.date_format', $code);
    }

    /** A receipt for a sale rung at 12:47 on the 6th of October 2026, in Lahore. */
    private function receipt(): string
    {
        Carbon::setTestNow(Carbon::parse('2026-10-06 07:47:00', 'UTC'));
        $sale = $this->as()->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1000,
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        return (string) $this->as()->get("/api/v1/sales/{$sale['id']}/invoice")->assertOk()->getContent();
    }

    public function test_a_new_shop_writes_the_day_the_way_nobody_can_misread(): void
    {
        $this->as()->getJson('/api/v1/shop/settings')->assertOk()->assertJsonPath('data.date_format', DateFormats::DEFAULT);

        $this->assertStringContainsString('6 Oct 2026 · 12:47 PM', $this->receipt());
    }

    public function test_the_receipt_is_written_the_way_the_shop_chose(): void
    {
        $ways = [
            'dmy' => '06/10/2026 · 12:47 PM',
            'mdy' => '10/06/2026 · 12:47 PM',
            'ymd' => '2026-10-06 · 12:47 PM',
            'dmy_text' => '6 Oct 2026 · 12:47 PM',
        ];

        foreach ($ways as $code => $written) {
            $this->writeDatesAs($code);
            $html = $this->receipt();

            $this->assertStringContainsString($written, $html, "the receipt is not written as {$code}");
            // …and in no other of the ways, on the same paper.
            foreach (array_diff($ways, [$written]) as $other) {
                $this->assertStringNotContainsString($other, $html, "the receipt of a {$code} shop also says {$other}");
            }
        }
    }

    public function test_a_way_that_is_not_on_the_list_is_refused_and_the_shop_keeps_its_own(): void
    {
        $this->writeDatesAs('dmy');

        $this->as()->putJson('/api/v1/shop/settings', ['date_format' => 'DD-MM-YY'])->assertStatus(422);
        $this->as()->getJson('/api/v1/shop/settings')->assertJsonPath('data.date_format', 'dmy');
        $this->assertSame('dmy', $this->tenant->fresh()->dateFormat());
    }

    public function test_a_quotation_and_its_last_day_follow_and_the_last_day_is_still_not_moved(): void
    {
        $this->writeDatesAs('mdy');
        Carbon::setTestNow(Carbon::parse('2026-10-06 21:30:00', 'UTC'));   // 02:30 on the 7th, locally

        $doc = $this->as()->postJson('/api/v1/sale-documents', [
            'kind' => 'quotation', 'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
            'expires_at' => '2026-10-20',
        ])->assertCreated()->json('data');
        $html = (string) $this->as()->get("/api/v1/sale-documents/{$doc['id']}/print")->assertOk()->getContent();

        $this->assertStringContainsString('10/07/2026, 02:30 AM', $html);
        // A calendar day: the 20th, written the shop's way, and not the 19th or the 21st.
        $this->assertStringContainsString('10/20/2026', $html);
        $this->assertStringNotContainsString('10/19/2026', $html);
        $this->assertStringNotContainsString('10/21/2026', $html);
        $this->assertStringNotContainsString('Oct 2026', $html, 'one date on the quotation is still written the old way');
    }

    public function test_the_z_read_follows(): void
    {
        $this->writeDatesAs('dmy');
        Carbon::setTestNow(Carbon::parse('2026-10-06 04:02:00', 'UTC'));   // 09:02 locally
        $this->as()->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])->assertSuccessful();
        Carbon::setTestNow(Carbon::parse('2026-10-06 16:15:00', 'UTC'));   // 21:15 locally
        $closed = $this->as()->postJson('/api/v1/pos/session/close', ['counted_cash' => 1000])->assertSuccessful()->json('data');

        $html = (string) $this->as()->get("/api/v1/pos/sessions/{$closed['id']}/z-report/print")->assertOk()->getContent();

        $this->assertStringContainsString('06/10/2026, 09:02', $html);
        $this->assertStringContainsString('06/10/2026, 21:15', $html);
    }

    public function test_a_file_for_a_machine_is_left_a_machines(): void
    {
        $this->writeDatesAs('mdy');
        $this->receipt();

        $csv = $this->as()->get('/api/v1/sales/export')->assertOk()->streamedContent();

        // An accountant's spreadsheet sorts this; it is not a date for reading aloud.
        $this->assertStringContainsString('2026-10-06 12:47:00', $csv);
        $this->assertStringNotContainsString('10/06/2026', $csv);
    }

    public function test_a_day_and_a_moment_are_written_by_the_shops_clock_helper_for_whoever_asks(): void
    {
        $this->writeDatesAs('dmy');
        $shop = $this->tenant->fresh();

        // A moment: moved to the shop's zone, then written its way.
        $this->assertSame('07/10/2026 · 02:00 AM', ShopTime::show(Carbon::parse('2026-10-06 21:00:00', 'UTC'), 'd M Y · h:i A', $shop));
        // Where the paper leaves the year off, so does the shop's date.
        $this->assertSame('07/10, 02:00', ShopTime::show(Carbon::parse('2026-10-06 21:00:00', 'UTC'), 'd M, H:i', $shop));
        // A day: never moved.
        $this->assertSame('20/10/2026', ShopTime::day('2026-10-20', $shop));
        $this->assertSame('20/10/2026', ShopTime::day(Carbon::parse('2026-10-20 00:00:00', 'UTC'), $shop));
        $this->assertSame('', ShopTime::day(null, $shop));
    }

    public function test_no_paper_writes_a_day_with_a_format_of_its_own(): void
    {
        /*
         * Three papers wrote a calendar day with `->format('d M Y')` — a
         * warranty's last day, a quotation's, a batch's expiry — which no
         * setting could reach. A view that formats a date for itself is the
         * way the next one will be missed.
         */
        $found = [];
        foreach (File::allFiles(resource_path('views')) as $view) {
            foreach (explode("\n", (string) file_get_contents($view->getPathname())) as $at => $line) {
                if (preg_match('/->format\(\s*[\'"][^\'"]*[dDjMYy]/', $line) === 1) {
                    $found[] = $view->getRelativePathname().':'.($at + 1).' '.trim($line);
                }
            }
        }

        $this->assertSame([], $found, "A paper writes a date with a format of its own — use ShopTime::show() for a moment, ShopTime::day() for a day:\n".implode("\n", $found));
    }
}
