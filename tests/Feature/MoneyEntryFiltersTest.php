<?php

namespace Tests\Feature;

use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\Income;
use App\Models\IncomeCategory;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Finding an entry again, and proving what a slice of the book adds up to.
 *
 * The expense and income lists ARE the product for a books-only business, and
 * "search the description, pick one category" does not answer the questions
 * people actually bring to their books: what went on rent between March and
 * June, what left in cash over fifty thousand, show me utilities AND fuel
 * together, what does that lot come to.
 */
class MoneyEntryFiltersTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private ExpenseCategory $rent;

    private ExpenseCategory $utilities;

    private IncomeCategory $investment;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->provisioned()->create(['timezone' => 'UTC']);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();

        $this->rent = ExpenseCategory::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'name' => 'Rent']);
        $this->utilities = ExpenseCategory::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'name' => 'Utilities']);
        $this->investment = IncomeCategory::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'name' => 'Owner Investment']);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function expense(string $date, float $amount, ExpenseCategory $cat, array $extra = []): Expense
    {
        return Expense::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->tenant->id,
            'expense_category_id' => $cat->id,
            'description' => 'Bill',
            'amount' => $amount,
            'payment_method' => 'cash',
            'expense_date' => $date,
        ], $extra));
    }

    private function list(array $params = []): array
    {
        return $this->actingAsUser($this->owner)
            ->getJson('/api/v1/expenses?'.http_build_query($params))
            ->assertOk()
            ->json();
    }

    // ── Finding it again ────────────────────────────────────────────

    public function test_search_reaches_the_bill_number_and_the_note_too(): void
    {
        // Description-only search means a merchant hunting an invoice number
        // finds nothing and concludes the entry was never made.
        $this->expense('2026-03-02', 4000, $this->utilities, ['reference' => 'KE-88213']);
        $this->expense('2026-03-03', 900, $this->rent, ['notes' => 'paid to landlord in person']);
        $this->expense('2026-03-04', 100, $this->rent, ['description' => 'Something else']);

        $this->assertCount(1, $this->list(['search' => '88213'])['data']);
        $this->assertCount(1, $this->list(['search' => 'landlord'])['data']);
    }

    public function test_two_categories_are_one_question(): void
    {
        $this->expense('2026-03-02', 4000, $this->rent);
        $this->expense('2026-03-03', 900, $this->utilities);
        $this->expense('2026-03-04', 100, ExpenseCategory::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Fuel',
        ]));

        $body = $this->list(['category_id' => "{$this->rent->id},{$this->utilities->id}"]);

        $this->assertCount(2, $body['data']);
        $this->assertEquals(4900, $body['meta']['totals']['total']);
    }

    public function test_a_date_window_and_an_amount_floor(): void
    {
        $this->expense('2026-02-27', 90000, $this->rent);
        $this->expense('2026-03-05', 60000, $this->rent);
        $this->expense('2026-03-06', 500, $this->rent);

        $body = $this->list(['from' => '2026-03-01', 'to' => '2026-03-31', 'min_amount' => 1000]);

        $this->assertCount(1, $body['data']);
        $this->assertEquals(60000, $body['meta']['totals']['total']);
    }

    public function test_the_last_day_of_the_window_is_inside_it(): void
    {
        // The classic off-by-one: a date-cast column stores "…-31 00:00:00",
        // which sorts after a bare "…-31" upper bound, so the final day's
        // entries silently vanish — and only on the last day of the month.
        $this->expense('2026-03-31', 1200, $this->rent);

        $this->assertCount(1, $this->list(['from' => '2026-03-01', 'to' => '2026-03-31'])['data']);
    }

    public function test_paying_in_cash_is_a_different_question_from_paying_by_bank(): void
    {
        $this->expense('2026-03-02', 4000, $this->rent, ['payment_method' => 'cash']);
        $this->expense('2026-03-03', 900, $this->rent, ['payment_method' => 'bank_transfer']);

        $this->assertCount(1, $this->list(['payment_method' => 'bank_transfer'])['data']);
        $this->assertCount(2, $this->list(['payment_method' => 'cash,bank_transfer'])['data']);
    }

    public function test_biggest_first(): void
    {
        $this->expense('2026-03-02', 400, $this->rent);
        $this->expense('2026-03-03', 9000, $this->rent);
        $this->expense('2026-03-04', 2000, $this->rent);

        $amounts = array_map(
            fn (array $r): float => (float) $r['amount'],
            $this->list(['sort' => 'amount', 'dir' => 'desc'])['data'],
        );

        $this->assertSame([9000.0, 2000.0, 400.0], $amounts);
    }

    // ── What the slice comes to ─────────────────────────────────────

    public function test_the_total_belongs_to_the_filter_not_to_the_whole_book(): void
    {
        // A page of 15 rows out of 400 with a grand total underneath is a
        // number nobody can reconcile against what they can see.
        foreach (range(1, 20) as $i) {
            $this->expense('2026-03-'.str_pad((string) $i, 2, '0', STR_PAD_LEFT), 1000, $this->rent);
        }
        $this->expense('2026-03-21', 5000, $this->utilities);

        $body = $this->list(['category_id' => $this->rent->id, 'per_page' => 5]);

        $this->assertCount(5, $body['data'], 'one page of rows');
        $this->assertSame(20, $body['meta']['totals']['count'], 'but the count of everything that matched');
        $this->assertEquals(20000, $body['meta']['totals']['total']);
    }

    // ── Handing it to the accountant ────────────────────────────────

    public function test_the_export_carries_the_filter_the_merchant_was_looking_at(): void
    {
        // What lands in the accountant's inbox has to match what was on
        // screen, or the merchant gets asked about rows they never saw.
        $this->expense('2026-03-02', 4000, $this->rent, ['description' => 'March rent']);
        $this->expense('2026-03-03', 900, $this->utilities, ['description' => 'Electricity']);

        $csv = $this->actingAsUser($this->owner)
            ->get('/api/v1/expenses/export?category_id='.$this->rent->id)
            ->assertOk()
            ->streamedContent();

        $this->assertStringContainsString('March rent', $csv);
        $this->assertStringNotContainsString('Electricity', $csv);
    }

    public function test_income_answers_the_same_questions(): void
    {
        // The two halves of the module must not support different questions.
        foreach ([['2026-03-02', 5000], ['2026-03-03', 250]] as [$date, $amount]) {
            Income::withoutTenancy()->create([
                'tenant_id' => $this->tenant->id,
                'income_category_id' => $this->investment->id,
                'description' => 'Capital', 'amount' => $amount,
                'payment_method' => 'bank_transfer', 'income_date' => $date,
            ]);
        }

        $body = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/incomes?min_amount=1000')
            ->assertOk()->json();

        $this->assertCount(1, $body['data']);
        $this->assertEquals(5000, $body['meta']['totals']['total']);

        $csv = $this->actingAsUser($this->owner)
            ->get('/api/v1/incomes/export')->assertOk()->streamedContent();

        $this->assertStringContainsString('Capital', $csv);
    }

    public function test_no_filter_means_no_restriction(): void
    {
        // An empty filter must never quietly apply a default — that is how a
        // total ends up disagreeing with the rows above it.
        $this->expense('2026-03-02', 4000, $this->rent);
        $this->expense('2026-03-03', 900, $this->utilities);

        $body = $this->list(['search' => '', 'category_id' => '', 'payment_method' => '']);

        $this->assertCount(2, $body['data']);
        $this->assertEquals(4900, $body['meta']['totals']['total']);
    }

    /**
     * THE TOTAL BELONGED TO EVERY SHOP AT ONCE.
     *
     * `totals()` cloned the query and then called `getQuery()`, which hands
     * back the underlying query builder BEFORE Eloquent applies its global
     * scopes. The rows on screen were tenant-scoped, because the paginator
     * goes through `toBase()`; the figure above them was not. So a shop with
     * 178 bills of its own read "1,096 entries · Rs 4,678,156" — a headcount
     * and a sum of every business on the platform, printed on its own books.
     *
     * Two failures in one. The number is wrong, which a merchant reconciling
     * a month will chase for an afternoon. And it is somebody else's number,
     * which is the part that matters.
     */
    public function test_the_total_counts_this_shop_and_no_other(): void
    {
        $this->expense('2026-03-02', 4000, $this->rent);
        $this->expense('2026-03-03', 900, $this->utilities);

        // Another business, on the same platform, with far more on its books.
        $other = Tenant::factory()->provisioned()->create();
        $theirCategory = ExpenseCategory::withoutTenancy()->create([
            'tenant_id' => $other->id, 'name' => 'Theirs',
        ]);
        foreach ([50000, 60000, 70000] as $amount) {
            Expense::withoutTenancy()->create([
                'tenant_id' => $other->id,
                'expense_category_id' => $theirCategory->id,
                'description' => 'Not ours',
                'amount' => $amount,
                'payment_method' => 'cash',
                'expense_date' => '2026-03-02',
            ]);
        }

        $body = $this->list();

        $this->assertCount(2, $body['data'], 'the ROWS were always scoped — only the total was not');
        $this->assertSame(2, $body['meta']['totals']['count']);
        $this->assertEquals(4900, $body['meta']['totals']['total']);
        // The two figures on the screen describe the same set of rows.
        $this->assertSame(
            $body['meta']['pagination']['total'],
            $body['meta']['totals']['count'],
            'the bar and the pager must be counting the same book',
        );
    }

    public function test_income_totals_are_scoped_to_this_shop_too(): void
    {
        Income::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            'income_category_id' => $this->investment->id,
            'description' => 'Ours', 'amount' => 1000,
            'payment_method' => 'cash', 'income_date' => '2026-03-02',
        ]);

        $other = Tenant::factory()->provisioned()->create();
        $theirs = IncomeCategory::withoutTenancy()->create([
            'tenant_id' => $other->id, 'name' => 'Theirs',
        ]);
        Income::withoutTenancy()->create([
            'tenant_id' => $other->id,
            'income_category_id' => $theirs->id,
            'description' => 'Not ours', 'amount' => 99000,
            'payment_method' => 'cash', 'income_date' => '2026-03-02',
        ]);

        $body = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/incomes')->assertOk()->json();

        $this->assertSame(1, $body['meta']['totals']['count']);
        $this->assertEquals(1000, $body['meta']['totals']['total']);
    }
}
