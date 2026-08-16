<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Tenant;
use App\Models\User;
use App\Services\ReportService;
use App\Support\BusinessTypes;
use App\Support\TaxYear;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * The year a Pakistani business is measured by.
 *
 * "This year" resolved to 1 January – 31 December everywhere on this platform,
 * and that is not the year anybody here files. FBR's tax year runs 1 July to
 * 30 June: the annual return, the audited accounts and every advance-tax
 * working sit inside that window, and a calendar-year total is a figure nobody
 * submits.
 *
 * The tenant it matters most to is the books-only one — Finance Manager has no
 * catalog, no stock and no till, so the date shortcut is not a convenience
 * there, it is the screen.
 */
class TaxYearTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $office;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);

        // The books-only tenant this exists for: no catalog, no stock, no till.
        $this->office = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'finance', 'features' => BusinessTypes::defaultFeatures('finance'),
        ]);
        $this->owner = User::factory()->shopOwner($this->office)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withHeader('Authorization', "Bearer {$token}");
    }

    // ── The rule ────────────────────────────────────────────────────────

    public function test_a_day_in_the_second_half_of_the_calendar_year_opens_the_year(): void
    {
        // 12 August 2026 sits in the tax year that began the July before it.
        $this->assertSame(
            ['from' => '2026-07-01', 'to' => '2027-06-30'],
            TaxYear::containing(CarbonImmutable::create(2026, 8, 12)),
        );
    }

    public function test_a_day_in_the_first_half_belongs_to_the_year_that_began_last_july(): void
    {
        // March is the month an accountant is most likely to ask this in, and
        // the calendar year would give them the wrong twelve months entirely.
        $this->assertSame(
            ['from' => '2025-07-01', 'to' => '2026-06-30'],
            TaxYear::containing(CarbonImmutable::create(2026, 3, 15)),
        );
    }

    public function test_the_thirtieth_of_june_closes_the_year_it_is_in(): void
    {
        // The boundary is the whole point. One day either side is a different
        // return.
        $this->assertSame(
            ['from' => '2025-07-01', 'to' => '2026-06-30'],
            TaxYear::containing(CarbonImmutable::create(2026, 6, 30)),
        );
    }

    public function test_the_first_of_july_opens_the_next_one(): void
    {
        $this->assertSame(
            ['from' => '2026-07-01', 'to' => '2027-06-30'],
            TaxYear::containing(CarbonImmutable::create(2026, 7, 1)),
        );
    }

    public function test_it_is_a_whole_year_even_across_a_leap_february(): void
    {
        // Derived by adding a year and stepping back a day rather than
        // hard-coding month lengths.
        $this->assertSame(
            ['from' => '2027-07-01', 'to' => '2028-06-30'],
            TaxYear::containing(CarbonImmutable::create(2028, 2, 29)),
        );
    }

    // ── The reports resolve it ──────────────────────────────────────────

    public function test_the_report_period_resolves_to_the_tax_year(): void
    {
        $this->travelTo(CarbonImmutable::create(2026, 3, 15));

        $resolved = app(ReportService::class)->resolvePeriod('tax_year', null, null);

        $this->assertSame('2025-07-01', $resolved['from']);
        $this->assertSame('2026-06-30', $resolved['to']);
        // Twelve months of daily buckets is not a chart anybody reads.
        $this->assertSame('month', $resolved['granularity']);
    }

    public function test_the_calendar_year_is_still_there(): void
    {
        // It is ADDED, never substituted. A shopkeeper asking "is saal kitna
        // kamaya" usually does mean January to December, and taking that away
        // to hand them their accountant's year answers a question they did not
        // ask.
        $this->travelTo(CarbonImmutable::create(2026, 3, 15));

        $resolved = app(ReportService::class)->resolvePeriod('yearly', null, null);

        $this->assertSame('2026-01-01', $resolved['from']);
        $this->assertSame('2026-12-31', $resolved['to']);
    }

    public function test_the_endpoint_accepts_the_tax_year_and_reports_the_window_it_used(): void
    {
        $this->travelTo(CarbonImmutable::create(2026, 3, 15));

        $this->actingAsUser($this->owner)
            ->getJson('/api/v1/reports/summary?period=tax_year')
            ->assertOk()
            ->assertJsonPath('data.period.from', '2025-07-01')
            ->assertJsonPath('data.period.to', '2026-06-30');
    }

    public function test_a_period_nobody_defined_is_still_refused(): void
    {
        // The validator gained one value, not a hole.
        $this->actingAsUser($this->owner)
            ->getJson('/api/v1/reports/summary?period=fiscal')
            ->assertStatus(422)
            ->assertJsonValidationErrors('period');
    }
}
