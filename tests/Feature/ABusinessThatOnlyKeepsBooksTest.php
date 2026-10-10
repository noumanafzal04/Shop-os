<?php

namespace Tests\Feature;

use App\Actions\Shop\ApplyBusinessTypeDefaultsAction;
use App\Models\City;
use App\Models\ExpenseCategory;
use App\Models\IncomeCategory;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * A BUSINESS THAT ONLY KEEPS BOOKS IS SPOKEN TO AS ONE.
 *
 * Found by living a month in a Finance Manager's books through the screen
 * (journey stage Q), not by reading the code — every endpoint here already
 * answered 200 and every existing test was green:
 *
 *   it was told, on EVERY cash entry, that it had no shift open and its drawer
 *   had not been adjusted — about a till it was never sold and cannot open
 *
 *   it was given five income categories, none of which is what an office, a
 *   school or a clinic earns; the whole of its revenue had to be filed under
 *   "Other Income"
 *
 * Both were a rule written for a shop and applied to a business that is not
 * one. The control in each test is the shop: it must go on hearing what it
 * heard before.
 */
class ABusinessThatOnlyKeepsBooksTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $office;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        Carbon::setTestNow('2026-10-10 11:00:00');

        [$this->office, $this->owner] = $this->business('finance');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    // ── cash, and the drawer it never had ───────────────────────────

    public function test_a_cash_bill_in_a_business_with_no_till_says_nothing_about_a_drawer(): void
    {
        $paid = $this->as($this->owner)->postJson('/api/v1/expenses', $this->bill($this->office, 'Electricity'))
            ->assertCreated();

        // Recorded, as cash, against no drawer — and nothing to hear about it.
        $paid->assertJsonPath('data.payment_method', 'cash')
            ->assertJsonPath('data.cash_movement_id', null)
            ->assertJsonMissingPath('meta.warnings');
    }

    public function test_a_shop_with_a_till_and_no_shift_open_still_hears_it(): void
    {
        // The control. The sentence is right for a shop: it has a drawer, the
        // cash came out of it, and nobody has opened a shift to say so.
        [$shop, $shopOwner] = $this->business('mart');
        $this->assertTrue($shop->featureEnabled('pos'));

        $this->as($shopOwner)->postJson('/api/v1/expenses', $this->bill($shop, 'Electricity'))
            ->assertCreated()
            ->assertJsonPath('meta.warnings.0', 'Recorded as cash, but you have no shift open — the drawer was not adjusted.');
    }

    public function test_cash_received_in_a_business_with_no_till_says_nothing_about_a_drawer(): void
    {
        $this->as($this->owner)->postJson('/api/v1/incomes', $this->receipt($this->office, 'Client Payments'))
            ->assertCreated()
            ->assertJsonPath('data.payment_method', 'cash')
            ->assertJsonMissingPath('meta.warnings');

        [$shop, $shopOwner] = $this->business('mart');
        $this->as($shopOwner)->postJson('/api/v1/incomes', $this->receipt($shop, 'Other Income'))
            ->assertCreated()
            ->assertJsonPath('meta.warnings.0', 'Recorded as cash, but you have no shift open — the drawer was not adjusted.');
    }

    public function test_a_bill_corrected_to_cash_says_nothing_about_a_drawer_either(): void
    {
        $bank = ['payment_method' => 'bank_transfer'];

        $expense = $this->as($this->owner)->postJson('/api/v1/expenses', $bank + $this->bill($this->office, 'Rent'))
            ->assertCreated()->json('data.id');
        $this->as($this->owner)->putJson("/api/v1/expenses/{$expense}", ['payment_method' => 'cash'] + $this->bill($this->office, 'Rent'))
            ->assertOk()
            ->assertJsonPath('data.payment_method', 'cash')
            ->assertJsonMissingPath('meta.warnings');

        $income = $this->as($this->owner)->postJson('/api/v1/incomes', $bank + $this->receipt($this->office, 'Service Fees'))
            ->assertCreated()->json('data.id');
        $this->as($this->owner)->putJson("/api/v1/incomes/{$income}", ['payment_method' => 'cash'] + $this->receipt($this->office, 'Service Fees'))
            ->assertOk()
            ->assertJsonPath('data.payment_method', 'cash')
            ->assertJsonMissingPath('meta.warnings');

        // The control, for the correction: a shop is told.
        [$shop, $shopOwner] = $this->business('mart');
        $theirs = $this->as($shopOwner)->postJson('/api/v1/expenses', $bank + $this->bill($shop, 'Rent'))
            ->assertCreated()->json('data.id');
        $this->as($shopOwner)->putJson("/api/v1/expenses/{$theirs}", ['payment_method' => 'cash'] + $this->bill($shop, 'Rent'))
            ->assertOk()
            ->assertJsonPath('meta.warnings.0', 'Changed to cash, but you have no shift open — the drawer was not adjusted.');
    }

    public function test_what_it_still_needs_to_hear_it_still_hears(): void
    {
        // Silencing the drawer must not silence the rest: the same bill twice
        // on one day is still worth a word, with or without a till.
        $this->as($this->owner)->postJson('/api/v1/expenses', $this->bill($this->office, 'Internet'))->assertCreated();

        $this->as($this->owner)->postJson('/api/v1/expenses', $this->bill($this->office, 'Internet'))
            ->assertCreated()
            ->assertJsonCount(1, 'meta.warnings')
            ->assertJsonPath('meta.warnings.0', 'A very similar expense (same category, amount and date) already exists.');
    }

    // ── what it earns ───────────────────────────────────────────────

    public function test_a_books_only_business_is_given_somewhere_to_file_what_it_earns(): void
    {
        $names = IncomeCategory::withoutTenancy()->where('tenant_id', $this->office->id)->pluck('name')->all();

        // What an office, an agency, a school, a trader keeping only books
        // here actually takes money for.
        foreach (['Client Payments', 'Service Fees', 'Sales', 'Commission', 'Donations & Grants'] as $earned) {
            $this->assertContains($earned, $names);
        }
        // And the odd ones every business has.
        foreach (['Interest', 'Owner Investment', 'Other Income'] as $odd) {
            $this->assertContains($odd, $names);
        }
        // Those and no others — the list is read back in no particular order.
        $this->assertEqualsCanonicalizing(BusinessTypes::defaultIncomeCategories('finance'), $names);
    }

    public function test_a_shop_that_sells_is_not_given_a_sales_bucket_to_double_count_in(): void
    {
        // The control: a shop's revenue is derived from its sales. A "Sales"
        // income category there is an invitation to type the day's takings in
        // a second time.
        foreach (['mart', 'food', 'pharmacy', 'retail', 'services', 'automotive', 'petroleum', 'online'] as $trade) {
            $names = BusinessTypes::defaultIncomeCategories($trade);

            $this->assertSame(['Other Income', 'Owner Investment', 'Supplier Refund', 'Interest', 'Rent Received'], $names, $trade);
        }

        // Asked about no trade in particular, the answer is the shop's.
        $this->assertNotContains('Sales', BusinessTypes::defaultIncomeCategories());
    }

    // ── what it is counted against ──────────────────────────────────

    public function test_its_subscription_counts_only_what_it_can_have(): void
    {
        $rows = collect($this->as($this->owner)->getJson('/api/v1/shop/subscription')->assertOk()->json('data.limits_usage'))
            ->keyBy('key');

        // An office has people, places and paper. It has no shelf, no orders,
        // no till and so no tablet to go offline.
        foreach (['storage_mb', 'branches', 'staff'] as $its) {
            $this->assertTrue($rows[$its]['applies'], "{$its} applies to every business.");
        }
        foreach (['products', 'orders_month', 'registers', 'offline_days', 'offline_selling', 'offline_hard_stop_days'] as $notIts) {
            $this->assertFalse($rows[$notIts]['applies'], "{$notIts} is not something a books-only business can use.");
        }

        // A rule about behaviour is not a count of things owned, for anybody.
        $this->assertSame('count', $rows['branches']['kind']);
        foreach (['offline_days', 'offline_selling', 'offline_hard_stop_days'] as $rule) {
            $this->assertSame('policy', $rows[$rule]['kind']);
        }
    }

    public function test_a_shop_is_counted_against_all_of_it(): void
    {
        // The control: nothing was taken away from a business that sells.
        [, $shopOwner] = $this->business('mart');

        $rows = collect($this->as($shopOwner)->getJson('/api/v1/shop/subscription')->assertOk()->json('data.limits_usage'));

        $this->assertSame([], $rows->where('applies', false)->pluck('key')->all());
    }

    public function test_the_row_follows_the_module_not_the_trade(): void
    {
        // A Finance Manager who is later given the till has registers to count
        // from that moment — the question is asked of the modules.
        $this->office->applyModules(['pos' => true]);

        $rows = collect($this->as($this->owner)->getJson('/api/v1/shop/subscription')->assertOk()->json('data.limits_usage'))
            ->keyBy('key');

        $this->assertTrue($rows['registers']['applies']);
        $this->assertTrue($rows['offline_selling']['applies']);
        $this->assertTrue($rows['orders_month']['applies']);
        // Still no shelf.
        $this->assertFalse($rows['products']['applies']);
    }

    public function test_it_is_not_told_it_pays_commission_on_orders_it_cannot_receive(): void
    {
        $this->as($this->owner)->getJson('/api/v1/commission')
            ->assertOk()
            ->assertJsonPath('data.applies', false);

        // The control: a shop with a storefront is.
        [$shop, $shopOwner] = $this->business('mart');
        $this->assertTrue($shop->featureEnabled('marketplace'));

        $this->as($shopOwner)->getJson('/api/v1/commission')
            ->assertOk()
            ->assertJsonPath('data.applies', true);
    }

    // ── what its books are waiting on ───────────────────────────────

    public function test_its_dashboard_says_which_bills_have_fallen_due(): void
    {
        $rent = $this->categoryOf($this->office, 'Rent');
        $net = $this->categoryOf($this->office, 'Internet');

        // Due on the 1st and still not posted on the 10th; due today; due on
        // the 15th (not yet); and one that is switched off.
        $this->recurring($rent, 'Office rent', 85000, '2026-10-01');
        $this->recurring($net, 'Fibre line', 6500, '2026-10-10');
        $this->recurring($net, 'Backup line', 3000, '2026-10-15');
        $this->recurring($rent, 'Old store room', 20000, '2026-09-01', active: false);

        $books = $this->as($this->owner)->getJson('/api/v1/dashboard')->assertOk()->json('data.books');

        $this->assertSame(2, $books['bills_due']['count']);
        $this->assertEquals(91500, $books['bills_due']['amount']);
        $this->assertSame('2026-10-01', $books['bills_due']['oldest']);
        // Nothing is expected IN.
        $this->assertSame(0, $books['income_due']['count']);
        $this->assertNull($books['income_due']['oldest']);
    }

    public function test_a_payment_it_is_expecting_is_said_apart_from_a_bill_it_owes(): void
    {
        $fees = IncomeCategory::withoutTenancy()->where('tenant_id', $this->office->id)->where('name', 'Client Payments')->value('id');

        $this->as($this->owner)->postJson('/api/v1/incomes/recurring', [
            'income_category_id' => $fees, 'description' => 'Retainer — Al-Noor Textiles', 'amount' => 150000,
            'frequency' => 'monthly', 'next_due_on' => '2026-10-05', 'payment_method' => 'bank_transfer',
        ])->assertCreated();

        $books = $this->as($this->owner)->getJson('/api/v1/dashboard')->assertOk()->json('data.books');

        $this->assertSame(1, $books['income_due']['count']);
        $this->assertEquals(150000, $books['income_due']['amount']);
        $this->assertSame('2026-10-05', $books['income_due']['oldest']);
        $this->assertSame(0, $books['bills_due']['count']);
    }

    public function test_its_dashboard_says_which_categories_have_gone_past_their_ceiling(): void
    {
        $marketing = $this->categoryOf($this->office, 'Marketing');
        $travel = $this->categoryOf($this->office, 'Travel');
        $rent = $this->categoryOf($this->office, 'Rent');

        // Marketing: 20,000 allowed, 26,500 spent. Travel: 10,000 allowed,
        // 10,000 spent — AT the ceiling is not past it. Rent: no ceiling.
        foreach ([[$marketing, 20000], [$travel, 10000]] as [$category, $ceiling]) {
            $this->as($this->owner)->postJson('/api/v1/expenses/budgets', ['expense_category_id' => $category, 'amount' => $ceiling])->assertSuccessful();
        }
        $bank = ['payment_method' => 'bank_transfer', 'expense_date' => '2026-10-08'];
        $this->as($this->owner)->postJson('/api/v1/expenses', $bank + ['expense_category_id' => $marketing, 'description' => 'Billboard', 'amount' => 26500])->assertCreated();
        $this->as($this->owner)->postJson('/api/v1/expenses', $bank + ['expense_category_id' => $travel, 'description' => 'Karachi trip', 'amount' => 10000])->assertCreated();
        $this->as($this->owner)->postJson('/api/v1/expenses', $bank + ['expense_category_id' => $rent, 'description' => 'October rent', 'amount' => 85000])->assertCreated();
        // Last month's overspend is last month's.
        $this->as($this->owner)->postJson('/api/v1/expenses', ['payment_method' => 'bank_transfer', 'expense_date' => '2026-09-20', 'expense_category_id' => $travel, 'description' => 'September trip', 'amount' => 90000])->assertCreated();

        $over = $this->as($this->owner)->getJson('/api/v1/dashboard')->assertOk()->json('data.books.over_budget');

        $this->assertSame(1, $over['count']);
        $this->assertEquals(6500, $over['over_by']);
        $this->assertSame(['Marketing'], $over['categories']);

        // And it is the figure the Budgets tab gives for the same month.
        $tab = collect($this->as($this->owner)->getJson('/api/v1/expenses/budgets?month=2026-10-01')->assertOk()->json('data'));
        $this->assertSame(['Marketing'], $tab->where('over', true)->pluck('category')->values()->all());
    }

    public function test_a_shop_that_keeps_no_books_is_sent_no_books_block(): void
    {
        [$shop, $shopOwner] = $this->business('mart');
        $shop->applyModules(['expenses' => false]);

        $this->as($shopOwner)->getJson('/api/v1/dashboard')->assertOk()->assertJsonPath('data.books', null);

        // The control: a shop that does keep them is told, just as an office is.
        [, $keeper] = $this->business('mart');
        $this->as($keeper)->getJson('/api/v1/dashboard')->assertOk()
            ->assertJsonPath('data.books.bills_due.count', 0)
            ->assertJsonPath('data.books.over_budget.count', 0);
    }

    // ── helpers ─────────────────────────────────────────────────────

    private function categoryOf(Tenant $tenant, string $name): string
    {
        return ExpenseCategory::withoutTenancy()->where('tenant_id', $tenant->id)->where('name', $name)->value('id');
    }

    private function recurring(string $category, string $what, int $amount, string $due, bool $active = true): void
    {
        $id = $this->as($this->owner)->postJson('/api/v1/expenses/recurring', [
            'expense_category_id' => $category, 'description' => $what, 'amount' => $amount,
            'frequency' => 'monthly', 'next_due_on' => $due, 'payment_method' => 'bank_transfer',
        ])->assertCreated()->json('data.id');

        if (! $active) {
            $this->as($this->owner)->putJson("/api/v1/expenses/recurring/{$id}", ['is_active' => false])->assertOk();
        }
    }

    /** @return array{0: Tenant, 1: User} */
    private function business(string $trade): array
    {
        $city = City::query()->firstOrCreate(['name' => 'Lahore'], ['is_active' => true]);

        $tenant = Tenant::factory()->create([
            'setup_completed' => true,
            'city_id' => $city->id,
            'features' => null,
            'timezone' => 'UTC',
        ]);
        // The way a business really gets its modules and its categories.
        app(ApplyBusinessTypeDefaultsAction::class)->execute($tenant, $trade);

        return [$tenant->fresh(), User::factory()->shopOwner($tenant)->create()];
    }

    /** @return array<string, mixed> */
    private function bill(Tenant $tenant, string $category): array
    {
        $id = ExpenseCategory::withoutTenancy()->where('tenant_id', $tenant->id)->where('name', $category)->value('id')
            ?? ExpenseCategory::withoutTenancy()->create(['tenant_id' => $tenant->id, 'name' => $category])->id;

        return [
            'expense_category_id' => $id,
            'description' => "{$category} — October",
            'amount' => 18400,
            'expense_date' => '2026-10-10',
            'payment_method' => 'cash',
        ];
    }

    /** @return array<string, mixed> */
    private function receipt(Tenant $tenant, string $category): array
    {
        $id = IncomeCategory::withoutTenancy()->where('tenant_id', $tenant->id)->where('name', $category)->value('id');
        $this->assertNotNull($id, "{$category} is not one of this business's income categories.");

        return [
            'income_category_id' => $id,
            'description' => "{$category} — invoice 114",
            'amount' => 250000,
            'income_date' => '2026-10-10',
            'payment_method' => 'cash',
        ];
    }

    private function as(User $user): static
    {
        $this->defaultHeaders = [];
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
