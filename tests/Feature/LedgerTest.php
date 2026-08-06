<?php

namespace Tests\Feature;

use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\Income;
use App\Models\IncomeCategory;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * The ledger — every movement of money, one row each, balance carried down.
 *
 * The Cashbook says what each DAY came to. That is a summary, and a books-only
 * business (Finance Manager) cannot work from it: their whole job is checking
 * the lines. A day that says "Rs 41,200 out" with no way to open it is an
 * answer nobody can verify.
 *
 * The invariants worth holding:
 *
 *   - the balance is a BALANCE, not a running total of an arbitrary window:
 *     it opens at whatever the book stood at before the period
 *   - narrowing the view never rewrites the opening balance — filtering to
 *     "rent only" must not claim the month began with nothing but rent
 *   - sales revenue is DERIVED here exactly as the Cashbook derives it, so
 *     the two screens can never disagree, and never double-counted
 *   - a refunded sale still brought its money in on the day; only a CANCELLED
 *     sale never happened
 *   - page three continues from where page two ended
 */
class LedgerTest extends TestCase
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

        $this->rent = ExpenseCategory::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Rent',
        ]);
        $this->utilities = ExpenseCategory::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Utilities',
        ]);
        $this->investment = IncomeCategory::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Owner Investment',
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function expense(string $date, float $amount, ?ExpenseCategory $category = null, array $extra = []): Expense
    {
        return Expense::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->tenant->id,
            'expense_category_id' => ($category ?? $this->rent)->id,
            'description' => 'Bill',
            'amount' => $amount,
            'payment_method' => 'cash',
            'expense_date' => $date,
        ], $extra));
    }

    private function income(string $date, float $amount, array $extra = []): Income
    {
        return Income::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->tenant->id,
            'income_category_id' => $this->investment->id,
            'description' => 'Capital',
            'amount' => $amount,
            'payment_method' => 'bank_transfer',
            'income_date' => $date,
        ], $extra));
    }

    /** @return array<string, mixed> */
    private function ledger(array $params = []): array
    {
        return $this->actingAsUser($this->owner)
            ->getJson('/api/v1/ledger?'.http_build_query($params + [
                'period' => 'custom', 'from' => '2026-03-01', 'to' => '2026-03-31',
            ]))
            ->assertOk()
            ->json();
    }

    // ── The balance is a balance ────────────────────────────────────

    public function test_the_book_opens_at_what_it_stood_at_before_the_period(): void
    {
        // February: put 10,000 in, spend 4,000. March opens at 6,000.
        $this->income('2026-02-10', 10000);
        $this->expense('2026-02-20', 4000);
        $this->expense('2026-03-05', 1000);

        $body = $this->ledger();

        $this->assertEquals(6000, $body['meta']['opening']);
        $this->assertEquals(5000, $body['meta']['closing']);
        // And the first March row carries on from the opening figure.
        $this->assertEquals(5000, $body['data'][0]['balance']);
    }

    public function test_the_balance_runs_down_the_page_in_the_order_things_happened(): void
    {
        $this->income('2026-03-01', 10000);
        $this->expense('2026-03-05', 2500, $this->rent);
        $this->expense('2026-03-09', 1500, $this->utilities);

        $rows = $this->ledger()['data'];

        $this->assertSame(['2026-03-01', '2026-03-05', '2026-03-09'], array_column($rows, 'date'));
        $this->assertEquals([10000, 7500, 6000], array_column($rows, 'balance'));
    }

    public function test_narrowing_the_view_never_rewrites_the_opening_balance(): void
    {
        // The account stood at 20,000 on 1 March, whatever slice you ask for.
        $this->income('2026-02-01', 20000);
        $this->expense('2026-03-02', 3000, $this->rent);
        $this->expense('2026-03-03', 500, $this->utilities);

        $all = $this->ledger();
        $rentOnly = $this->ledger(['category_id' => $this->rent->id]);

        $this->assertEquals(20000, $all['meta']['opening']);
        $this->assertEquals(20000, $rentOnly['meta']['opening'], 'a filter is a view, not a different account');
        $this->assertCount(1, $rentOnly['data']);
        $this->assertEquals(3500, $all['meta']['totals']['out']);
        $this->assertEquals(3000, $rentOnly['meta']['totals']['out']);
    }

    // ── Sales are derived, never re-entered ─────────────────────────

    public function test_a_sale_appears_as_money_in_without_being_recorded_twice(): void
    {
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Widget', 'price' => 2000, 'cost' => 1200, 'stock_quantity' => 10,
        ]);

        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 2000,
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
        ])->assertCreated();

        $body = $this->ledger([
            'period' => 'custom', 'from' => now()->toDateString(), 'to' => now()->toDateString(),
        ]);

        $sales = array_values(array_filter($body['data'], fn (array $r): bool => $r['type'] === 'sale'));

        $this->assertCount(1, $sales, 'one sale, one row — the cashbook must not add a second');
        $this->assertEquals(2000, $sales[0]['in']);
        $this->assertEquals(0, $sales[0]['out']);
    }

    public function test_the_ledger_and_the_cashbook_agree_to_the_paisa(): void
    {
        // Two screens over the same money must never disagree; the cashbook is
        // the day-level summary of exactly these rows.
        $this->income('2026-03-04', 7500);
        $this->expense('2026-03-04', 2200, $this->rent);
        $this->expense('2026-03-18', 800, $this->utilities);

        $ledger = $this->ledger()['meta'];
        $cashbook = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/cashbook?period=custom&from=2026-03-01&to=2026-03-31')
            ->assertOk()->json('data');

        $this->assertEquals($ledger['totals']['in'], $cashbook['totals']['money_in']);
        $this->assertEquals($ledger['totals']['out'], $cashbook['totals']['money_out']);
        $this->assertEquals($ledger['closing'], $cashbook['closing_balance']);
    }

    // ── Filters ─────────────────────────────────────────────────────

    public function test_several_categories_are_one_question_not_two_searches(): void
    {
        $this->expense('2026-03-02', 3000, $this->rent);
        $this->expense('2026-03-03', 500, $this->utilities);
        $this->income('2026-03-04', 900);

        $body = $this->ledger(['category_id' => "{$this->rent->id},{$this->utilities->id}"]);

        $this->assertCount(2, $body['data']);
        $this->assertEquals(3500, $body['meta']['totals']['out']);
    }

    public function test_only_what_went_out(): void
    {
        $this->income('2026-03-02', 4000);
        $this->expense('2026-03-03', 1200);

        $body = $this->ledger(['direction' => 'out']);

        $this->assertCount(1, $body['data']);
        $this->assertSame('expense', $body['data'][0]['type']);
    }

    public function test_anything_over_a_figure_looks_both_ways(): void
    {
        // "Show me anything big" means big in either direction.
        $this->income('2026-03-02', 80000);
        $this->expense('2026-03-03', 60000);
        $this->expense('2026-03-04', 900);

        $body = $this->ledger(['min_amount' => 50000]);

        $this->assertCount(2, $body['data']);
    }

    public function test_search_reaches_the_bill_number_not_just_the_description(): void
    {
        // A merchant hunting an invoice number who finds nothing concludes the
        // entry was never made.
        $this->expense('2026-03-02', 1000, $this->rent, ['reference' => 'K-ELECTRIC-8891']);
        $this->expense('2026-03-03', 2000, $this->utilities, ['reference' => 'SSGC-2201']);

        $body = $this->ledger(['search' => '8891']);

        $this->assertCount(1, $body['data']);
        $this->assertSame('K-ELECTRIC-8891', $body['data'][0]['reference']);
    }

    // ── Paging ──────────────────────────────────────────────────────

    public function test_page_three_continues_from_where_page_two_ended(): void
    {
        // A balance that restarts each page is not a balance.
        $this->income('2026-03-01', 100000);
        foreach (range(1, 12) as $i) {
            $this->expense('2026-03-'.str_pad((string) ($i + 1), 2, '0', STR_PAD_LEFT), 1000);
        }

        $first = $this->ledger(['per_page' => 5, 'page' => 1])['data'];
        $second = $this->ledger(['per_page' => 5, 'page' => 2])['data'];
        $third = $this->ledger(['per_page' => 5, 'page' => 3])['data'];

        // 100000 in, then 1000 out per row.
        $this->assertEquals(100000, $first[0]['balance']);
        $this->assertEquals(96000, end($first)['balance']);
        $this->assertEquals(95000, $second[0]['balance']);
        $this->assertEquals(91000, end($second)['balance']);
        $this->assertEquals(90000, $third[0]['balance']);
    }

    // ── The books-only shop this is for ─────────────────────────────

    public function test_a_books_only_shop_reaches_its_ledger(): void
    {
        // Finance Manager: the ledger rides the Expense module, not
        // reports.view — gating it behind a reporting permission would put
        // their only real screen out of their own reach.
        $books = Tenant::factory()->create([
            'business_type' => 'finance',
            'features' => BusinessTypes::defaultFeatures('finance'),
            'setup_completed' => true,
            'timezone' => 'UTC',
        ]);
        $owner = User::factory()->shopOwner($books)->create();

        $category = ExpenseCategory::withoutTenancy()->create([
            'tenant_id' => $books->id, 'name' => 'Office Supplies',
        ]);
        Expense::withoutTenancy()->create([
            'tenant_id' => $books->id, 'expense_category_id' => $category->id,
            'description' => 'Printer paper', 'amount' => 1500,
            'payment_method' => 'cash', 'expense_date' => '2026-03-06',
        ]);

        $body = $this->actingAsUser($owner)
            ->getJson('/api/v1/ledger?period=custom&from=2026-03-01&to=2026-03-31')
            ->assertOk()->json();

        $this->assertCount(1, $body['data']);
        $this->assertSame('Office Supplies', $body['data'][0]['category']);
        $this->assertEquals(-1500, $body['data'][0]['balance']);
    }

    public function test_the_export_is_the_whole_filtered_book_not_the_first_page(): void
    {
        $this->income('2026-03-01', 50000);
        foreach (range(1, 30) as $i) {
            $this->expense('2026-03-'.str_pad((string) $i, 2, '0', STR_PAD_LEFT), 100);
        }

        $csv = $this->actingAsUser($this->owner)
            ->get('/api/v1/ledger/export?period=custom&from=2026-03-01&to=2026-03-31&per_page=5')
            ->assertOk()
            ->streamedContent();

        // 31 entries + header, whatever per_page said.
        $this->assertSame(32, count(array_filter(explode("\n", trim($csv)))));
        $this->assertStringContainsString('Balance', $csv);
    }
}
