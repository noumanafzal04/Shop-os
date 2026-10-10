<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\SubscriptionPayment;
use App\Models\Tenant;
use App\Models\User;
use App\Support\CsvExport;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * THE LEDGER AS A FILE — all of it, not the page.
 *
 * The billing screen's button read "Export this page" and meant it: twenty
 * rows, built in the browser from what was on screen. A month has more than
 * twenty payments, and "what did we take in September" handed to an
 * accountant as page one of three is a wrong answer that looks complete.
 *
 * ── What each test is guarding ─────────────────────────────────────────
 *
 *   every row the filter leaves is in the file — past the page size
 *   the file is the SAME rows the screen lists and totals, for each filter
 *   a shop that has since been closed keeps its name in it
 *   a name that would run as a formula in a spreadsheet does not
 *   only somebody who may see the money can take the file
 */
class BillingLedgerAsAFileTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Tenant $shop;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(PlanSeeder::class);
        Carbon::setTestNow('2026-10-14 10:30:00');
        $this->admin = User::factory()->superAdmin()->create();
        $this->shop = Tenant::factory()->create([
            'business_name' => 'Corner Mart',
            'plan_id' => Plan::query()->where('code', 'basic')->value('id'),
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function asAdmin(): static
    {
        $token = $this->admin->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function paid(string $at, float $amount = 5000, array $more = []): SubscriptionPayment
    {
        return SubscriptionPayment::query()->create(array_merge([
            'tenant_id' => $this->shop->id,
            'plan_name' => 'Basic',
            'amount' => $amount,
            'method' => 'cash',
            'period_start' => Carbon::parse($at)->toDateString(),
            'period_end' => Carbon::parse($at)->addMonth()->toDateString(),
            'paid_at' => $at,
        ], $more));
    }

    /** @return array<int, array<int, string>> the file's rows, header first */
    private function file(string $query = ''): array
    {
        $response = $this->asAdmin()->get('/api/v1/admin/billing/payments/export'.$query)->assertOk();
        $this->assertStringContainsString('text/csv', (string) $response->headers->get('Content-Type'));
        $this->assertStringContainsString('subscription-payments-2026-10-14.csv', (string) $response->headers->get('Content-Disposition'));

        $text = preg_replace('/^\xEF\xBB\xBF/', '', $response->streamedContent());

        return array_map(fn (string $line) => str_getcsv($line), array_values(array_filter(explode("\n", trim((string) $text)))));
    }

    public function test_every_payment_is_in_the_file_not_only_the_first_page(): void
    {
        for ($day = 1; $day <= 27; $day++) {
            $this->paid(sprintf('2026-09-%02d 12:00:00', $day), 1000 + $day);
        }

        // The screen holds twenty of them…
        $this->assertCount(20, $this->asAdmin()->getJson('/api/v1/admin/billing/payments')->assertOk()->json('data'));

        // …and the file holds all twenty-seven, under a header, newest first.
        $rows = $this->file();
        $this->assertSame(['Paid', 'Business', 'Plan', 'Period start', 'Period end', 'Method', 'Reference', 'Amount', 'Currency'], $rows[0]);
        $this->assertCount(28, $rows);
        $this->assertSame('2026-09-27', $rows[1][0]);
        $this->assertSame('2026-09-01', $rows[27][0]);
        $this->assertSame('Corner Mart', $rows[1][1]);
        $this->assertEquals(1027, $rows[1][7]);
    }

    public function test_the_file_is_the_rows_the_screen_lists_and_totals_for_each_filter(): void
    {
        $other = Tenant::factory()->create(['business_name' => 'Karahi House']);
        $this->paid('2026-08-31 23:59:59', 100);
        $this->paid('2026-09-01 00:00:00', 1000, ['reference' => 'RCPT-77']);
        $this->paid('2026-09-15 09:00:00', 2000, ['method' => 'bank_transfer']);
        $this->paid('2026-09-30 23:59:59', 4000, ['tenant_id' => $other->id]);
        $this->paid('2026-10-01 00:00:00', 800);

        foreach ([
            '?from=2026-09-01&to=2026-09-30',
            '?method=bank_transfer',
            '?search=Karahi',
            '?search=RCPT-77',
            '?from=2026-09-01&to=2026-09-30&method=cash',
            '?tenant_id='.$other->id,
        ] as $filter) {
            $screen = $this->asAdmin()->getJson('/api/v1/admin/billing/payments'.$filter.'&per_page=100')->assertOk();
            $rows = array_slice($this->file($filter), 1);

            $this->assertCount($screen->json('meta.totals.payments'), $rows, "the file and the screen disagree on how many for {$filter}");
            $this->assertEquals($screen->json('meta.totals.amount'), array_sum(array_column($rows, 7)), "…and on how much for {$filter}");
            $this->assertSame(
                collect($screen->json('data'))->pluck('reference')->map(fn ($r) => (string) $r)->all(),
                array_column($rows, 6),
                "…and on which, in what order, for {$filter}",
            );
        }
    }

    public function test_a_shop_that_has_since_been_closed_keeps_its_name_in_the_file(): void
    {
        $this->paid('2026-09-10 10:00:00');
        $this->shop->delete();

        $this->assertSame('Corner Mart', $this->file()[1][1]);
    }

    public function test_a_name_that_would_run_as_a_formula_in_a_spreadsheet_does_not(): void
    {
        // A business name is chosen by the shop, and this file is opened by
        // the platform's accountant.
        $this->shop->update(['business_name' => '=HYPERLINK("http://example.test","Refund")']);
        $this->paid('2026-09-10 10:00:00', 5000, ['reference' => '@SUM(A1:A9)']);

        $row = $this->file()[1];
        $this->assertSame("'=HYPERLINK(\"http://example.test\",\"Refund\")", $row[1]);
        $this->assertSame("'@SUM(A1:A9)", $row[6]);
        // A figure is still a figure.
        $this->assertEquals(5000, $row[7]);
    }

    public function test_a_number_is_left_a_number_and_ordinary_words_are_left_alone(): void
    {
        $this->assertSame('-500', CsvExport::text('-500'));
        $this->assertSame('-500.25', CsvExport::text('-500.25'));
        $this->assertSame(-500, CsvExport::text(-500));
        $this->assertSame('Al-Noor Traders', CsvExport::text('Al-Noor Traders'));
        $this->assertSame("'-Noor", CsvExport::text('-Noor'));
        $this->assertSame("'+92 300 1234567", CsvExport::text('+92 300 1234567'));
        $this->assertNull(CsvExport::text(null));
        $this->assertSame('', CsvExport::text(''));
    }

    public function test_the_browser_is_allowed_to_read_what_the_file_is_called(): void
    {
        // The panel is another origin, and a browser hides every response
        // header a server does not name. The file's name was one of them: an
        // export arrived as `export.csv` whatever the server had called it.
        $this->paid('2026-09-10 10:00:00');

        $response = $this->asAdmin()
            ->withHeaders(['Origin' => 'http://localhost:5177'])
            ->get('/api/v1/admin/billing/payments/export')
            ->assertOk();

        $exposed = array_map('trim', explode(',', strtolower((string) $response->headers->get('Access-Control-Expose-Headers'))));
        $this->assertContains('content-disposition', $exposed);
        // The receipt's own headers, which were exposed already, still are.
        $this->assertContains('x-receipt-print-id', $exposed);
    }

    public function test_only_somebody_who_may_see_the_money_can_take_the_file(): void
    {
        $this->paid('2026-09-10 10:00:00');

        $token = User::factory()->adminStaff([])->create()->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->get('/api/v1/admin/billing/payments/export')->assertForbidden();

        $token = User::factory()->adminStaff(['billing.view'])->create()->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->get('/api/v1/admin/billing/payments/export')->assertOk();
    }
}
