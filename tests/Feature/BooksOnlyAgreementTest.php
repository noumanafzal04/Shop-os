<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\ExpenseCategory;
use App\Models\IncomeCategory;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * The books-only tenant's daily loop, and the invariant it exists to protect:
 * every screen that prints a bottom line must print the SAME bottom line.
 *
 * The Finance Manager type is sold standalone to businesses whose earnings are
 * not sales — a consultant, an agency, an NGO. Their money in is an Income row,
 * not a Sale. The dashboard and the reports summary both computed
 *
 *      profit = sales revenue − cost of goods − expenses
 *
 * with no term for income at all, while the Cashbook computed
 *
 *      net = (sales revenue + other income) − (expenses + refunds)
 *
 * So a consultant who invoiced Rs 300,000 and paid Rs 80,000 of rent was told
 * by the Cashbook they were Rs 220,000 up and by the Reports screen — which
 * renders `net_profit` as its headline "Net" card for exactly this type — that
 * they were Rs 80,000 DOWN. Same tenant, same month, one click apart, and the
 * sign was wrong.
 *
 * The whole module was built, shipped and tested without this ever failing,
 * because `finance` had no suite that walked its own daily loop. This is it.
 */
class BooksOnlyAgreementTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private IncomeCategory $fees;

    private ExpenseCategory $rent;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'business_type' => 'finance',
            'features' => BusinessTypes::defaultFeatures('finance'),
            'setup_completed' => true,
            'city_id' => $city->id,
            'timezone' => 'Asia/Karachi',
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();

        $this->fees = IncomeCategory::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Consulting fees', 'is_active' => true,
        ]);
        $this->rent = ExpenseCategory::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Rent', 'is_active' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('test-device', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** The month a consultant bills a retainer and pays the rent. */
    private function aMonthOfBooks(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/incomes', [
            'income_category_id' => $this->fees->id,
            'description' => 'Retainer — August',
            'amount' => 300000,
            'income_date' => now()->toDateString(),
        ])->assertSuccessful();

        $this->actingAsUser($this->owner)->postJson('/api/v1/expenses', [
            'expense_category_id' => $this->rent->id,
            'description' => 'Office rent',
            'amount' => 80000,
            'expense_date' => now()->toDateString(),
            'payment_method' => 'bank_transfer',
        ])->assertSuccessful();
    }

    public function test_the_cashbook_the_summary_and_the_dashboard_agree_to_the_rupee(): void
    {
        $this->aMonthOfBooks();

        $cashbook = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/cashbook?period=monthly')->assertOk();
        $summary = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/reports/summary?period=monthly')->assertOk();
        $dashboard = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/dashboard')->assertOk();

        // Rs 300,000 in, Rs 80,000 out. The business is Rs 220,000 ahead, and
        // there is only one right answer to that.
        $this->assertEquals(220000, $cashbook->json('data.totals.net'));
        $this->assertEquals(220000, $summary->json('data.totals.net_profit'));
        $this->assertEquals(220000, $dashboard->json('data.today.profit'));
    }

    /** Money in is published as its own figure, not folded into sales. */
    public function test_income_is_reported_separately_from_sales_revenue(): void
    {
        $this->aMonthOfBooks();

        $summary = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/reports/summary?period=monthly')->assertOk();

        // A books-only business made no sales — that must stay true, or the
        // fix would have papered over the hole by calling income "revenue".
        $this->assertEquals(0, $summary->json('data.totals.revenue'));
        $this->assertEquals(0, $summary->json('data.totals.sales_count'));
        $this->assertEquals(300000, $summary->json('data.totals.other_income'));

        $dashboard = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/dashboard')->assertOk();
        $this->assertEquals(0, $dashboard->json('data.today.revenue'));
        $this->assertEquals(300000, $dashboard->json('data.today.other_income'));
    }

    /** The chart a books-only shop draws has both sides of the story on it. */
    public function test_the_series_carries_income_so_the_chart_is_not_expenses_alone(): void
    {
        $this->aMonthOfBooks();

        $summary = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/reports/summary?period=monthly')->assertOk();
        $today = now()->toDateString();

        $bucket = collect($summary->json('data.series'))->firstWhere('date', $today);
        $this->assertNotNull($bucket, 'today must have a bucket in the series');
        $this->assertEquals(300000, $bucket['other_income']);
        $this->assertEquals(80000, $bucket['expenses']);

        $week = collect($this->actingAsUser($this->owner)->getJson('/api/v1/dashboard')
            ->json('data.sales_series'))->firstWhere('date', $today);
        $this->assertEquals(300000, $week['other_income']);
    }

    /**
     * A quiet month must not invent a profit. Income is added, never assumed —
     * the guard against "fixed it by adding a constant".
     */
    public function test_a_month_with_no_income_still_reports_the_loss(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/expenses', [
            'expense_category_id' => $this->rent->id,
            'description' => 'Office rent',
            'amount' => 80000,
            'expense_date' => now()->toDateString(),
            'payment_method' => 'bank_transfer',
        ])->assertSuccessful();

        $summary = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/reports/summary?period=monthly')->assertOk();

        $this->assertEquals(0, $summary->json('data.totals.other_income'));
        $this->assertEquals(-80000, $summary->json('data.totals.net_profit'));
        $this->assertEquals(
            -80000,
            $this->actingAsUser($this->owner)->getJson('/api/v1/cashbook?period=monthly')
                ->json('data.totals.net'),
        );
    }
}
