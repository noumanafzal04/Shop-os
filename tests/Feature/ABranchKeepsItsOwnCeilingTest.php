<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\City;
use App\Models\ExpenseCategory;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * A BRANCH KEEPS ITS OWN CEILING — and the budgets are read in one question.
 *
 * Two things found while counting what the dashboard asks the database:
 *
 *   The ceiling of every expense category was asked for one category at a
 *   time — eight categories, eight queries, on the first screen an owner
 *   opens and again on the budgets page.
 *
 *   And reading them together showed the rule had only half been written.
 *   "Standing at a branch: its own ceiling, falling back to the company-wide
 *   one" was a comment; the code took whichever of the two rows the database
 *   happened to return first. A branch that set its own rent ceiling AFTER the
 *   company set one was still held to the company's — and the other way round
 *   it worked, which is why nobody saw it.
 */
class ABranchKeepsItsOwnCeilingTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Branch $gulberg;

    private ExpenseCategory $rent;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'), 'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->gulberg = Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Gulberg', 'is_default' => false, 'is_active' => true,
        ]);
        $this->rent = $this->category('Rent');
    }

    private function category(string $name): ExpenseCategory
    {
        return ExpenseCategory::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => $name, 'is_active' => true]);
    }

    /** The owner, standing at a branch — or looking at the whole company. */
    private function at(?Branch $branch): static
    {
        $this->defaultHeaders = [];
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token)->withHeaders(['X-Branch-Id' => $branch?->id ?? '']);
    }

    private function setCeiling(?Branch $at, ExpenseCategory $category, float $amount, ?string $month = null): void
    {
        $this->at($at)->postJson('/api/v1/expenses/budgets', array_filter([
            'expense_category_id' => $category->id, 'amount' => $amount, 'month' => $month,
        ], fn ($v) => $v !== null))->assertOk();
    }

    /** @return array<string, mixed> */
    private function rentAt(?Branch $branch): array
    {
        $rows = $this->at($branch)->getJson('/api/v1/expenses/budgets')->assertOk()->json('data');

        return collect($rows)->firstWhere('category', 'Rent');
    }

    public function test_a_branch_that_set_its_own_ceiling_is_held_to_it_whichever_was_written_first(): void
    {
        // The company first, the branch after: the order that used to lose.
        $this->setCeiling(null, $this->rent, 100000);
        $this->setCeiling($this->gulberg, $this->rent, 40000);

        $this->assertEquals(40000, $this->rentAt($this->gulberg)['budget'], 'the branch is held to the company\'s ceiling, not its own');
        $this->assertEquals(40000, $this->rentAt($this->gulberg)['standing']);

        // And the other order, on another category, reads the same way.
        $power = $this->category('Electricity');
        $this->setCeiling($this->gulberg, $power, 15000);
        $this->setCeiling(null, $power, 60000);
        $rows = $this->at($this->gulberg)->getJson('/api/v1/expenses/budgets')->json('data');
        $this->assertEquals(15000, collect($rows)->firstWhere('category', 'Electricity')['budget']);
    }

    public function test_the_whole_company_view_counts_only_a_ceiling_the_company_set(): void
    {
        $this->setCeiling(null, $this->rent, 100000);
        $this->setCeiling($this->gulberg, $this->rent, 40000);

        $this->assertEquals(100000, $this->rentAt(null)['budget']);

        // A category only a branch budgeted has no company ceiling at all.
        $power = $this->category('Electricity');
        $this->setCeiling($this->gulberg, $power, 15000);
        $rows = $this->at(null)->getJson('/api/v1/expenses/budgets')->json('data');
        $this->assertNull(collect($rows)->firstWhere('category', 'Electricity')['budget']);
    }

    public function test_a_branch_with_no_ceiling_of_its_own_falls_back_to_the_companys(): void
    {
        $this->setCeiling(null, $this->rent, 100000);

        $rent = $this->rentAt($this->gulberg);

        $this->assertEquals(100000, $rent['budget']);
        $this->assertFalse($rent['is_override']);
    }

    public function test_this_months_figure_still_beats_the_standing_one_and_the_branchs_own_month_beats_the_companys(): void
    {
        $thisMonth = now()->toDateString();

        $this->setCeiling($this->gulberg, $this->rent, 40000);            // the branch's standing figure
        $this->setCeiling(null, $this->rent, 120000, $thisMonth);          // the company's figure for this month

        $rent = $this->rentAt($this->gulberg);
        $this->assertEquals(120000, $rent['budget'], 'a month\'s own figure did not beat a standing one');
        $this->assertTrue($rent['is_override']);
        $this->assertEquals(40000, $rent['standing'], 'the standing figure shown is not the branch\'s own');

        $this->setCeiling($this->gulberg, $this->rent, 55000, $thisMonth); // and the branch's own, for this month
        $this->assertEquals(55000, $this->rentAt($this->gulberg)['budget']);
    }

    public function test_every_categorys_ceiling_is_read_in_one_question_however_many_there_are(): void
    {
        foreach (['Electricity', 'Gas', 'Salaries', 'Packaging', 'Repairs', 'Marketing', 'Transport'] as $n => $name) {
            $this->setCeiling(null, $this->category($name), 1000 * ($n + 1));
        }
        $this->setCeiling(null, $this->rent, 100000);

        $request = $this->at(null);
        $asked = 0;
        DB::listen(function ($query) use (&$asked): void {
            if (preg_match('/\bfrom\s+["`]?expense_budgets["`]?/i', $query->sql)) {
                $asked++;
            }
        });

        $rows = $request->getJson('/api/v1/expenses/budgets')->assertOk()->json('data');

        $this->assertCount(8, $rows);
        $this->assertEquals(100000, collect($rows)->firstWhere('category', 'Rent')['budget']);
        $this->assertEquals(7000, collect($rows)->firstWhere('category', 'Transport')['budget']);
        $this->assertSame(1, $asked, "the budgets were read {$asked} times for eight categories");
    }
}
