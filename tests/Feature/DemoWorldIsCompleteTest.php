<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\CashSession;
use App\Models\Expense;
use App\Models\ExpenseBudget;
use App\Models\ExpenseCategory;
use App\Models\Income;
use App\Models\RecurringExpense;
use App\Models\SaleReturn;
use App\Models\Tenant;
use Database\Seeders\CitySeeder;
use Database\Seeders\DemoDataSeeder;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The demo world has to contain the features that shipped into it.
 *
 * For weeks it did not. Refunds, income, budgets, schedules and closed shifts
 * were all built, tested, and then absent from every demo tenant — so the only
 * way to see any of them was to type the data in by hand, and the branch-scope
 * work could not be shown at all because a refund never existed. A seeder that
 * silently stops covering the product is the same failure as a screen that
 * silently stops rendering it: everything passes, and nothing is there.
 *
 * These assertions are deliberately about PRESENCE and SHAPE, not counts. The
 * demo world is meant to keep growing; what must not happen again is a whole
 * feature having no row anywhere.
 */
class DemoWorldIsCompleteTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('public');
        $this->seed([CitySeeder::class, PlanSeeder::class, DemoDataSeeder::class]);
    }

    public function test_the_chain_actually_has_more_than_one_branch(): void
    {
        // Every money screen scopes by branch. With one branch per tenant a
        // scoping bug looks exactly like a working one, so the demo world needs
        // at least one shop where the filter has something to do.
        $chain = Tenant::query()->where('business_name', 'Metro Chain Superstore')->firstOrFail();

        $branches = Branch::withoutTenancy()->where('tenant_id', $chain->id)->get();

        $this->assertGreaterThan(1, $branches->count(), 'The chain has a single branch — branch scope cannot be demonstrated.');
        $this->assertSame(1, $branches->where('is_default', true)->count(), 'A shop has exactly one default branch.');
    }

    public function test_a_refund_exists_and_belongs_to_the_branch_of_its_sale(): void
    {
        // The invariant the branch-scope migration exists to hold: a refund
        // belongs to the trade it reverses, not the till that paid it out.
        $return = SaleReturn::withoutTenancy()->with('sale')->first();

        $this->assertNotNull($return, 'No demo tenant has a refund — the whole branch-scope fix is invisible.');
        $this->assertSame($return->sale->branch_id, $return->branch_id);
    }

    public function test_income_exists_and_one_row_carries_a_receipt_that_resolves(): void
    {
        $incomes = Income::withoutTenancy()->get();

        $this->assertNotEmpty($incomes, 'No income anywhere — the Cashbook shows only one side of the book.');

        $withReceipt = $incomes->firstWhere(fn (Income $i): bool => $i->attachment_path !== null);

        $this->assertNotNull($withReceipt, 'No income row has a receipt, which is the column that was unreachable.');
        // A path pointing at nothing renders a broken link, which demonstrates
        // the opposite of what the receipt feature does.
        $this->assertTrue(
            Storage::disk('public')->exists($withReceipt->attachment_path),
            'The receipt path points at a file that does not exist.',
        );
        $this->assertNotNull($withReceipt->attachment_url);
    }

    public function test_expenses_carry_the_three_things_that_used_to_be_unreachable(): void
    {
        $expenses = Expense::withoutTenancy()->get();

        $this->assertNotNull(
            $expenses->firstWhere(fn (Expense $e): bool => $e->supplier_id !== null),
            'No expense names a supplier, so the supplier picker has nothing to show.',
        );
        $this->assertNotNull(
            $expenses->firstWhere(fn (Expense $e): bool => $e->recurring_expense_id !== null),
            'No expense came from a schedule, so the `scheduled` badge never appears.',
        );
        $this->assertNotNull(
            $expenses->firstWhere(fn (Expense $e): bool => $e->notes !== null),
            'No expense has notes.',
        );
    }

    public function test_a_two_branch_shop_has_spend_on_both_sides(): void
    {
        // A branch filter that silently returns everything is invisible when
        // every row belongs to the only branch there is.
        $chain = Tenant::query()->where('business_name', 'Metro Chain Superstore')->firstOrFail();

        $branchesWithSpend = Expense::withoutTenancy()
            ->where('tenant_id', $chain->id)
            ->distinct()
            ->pluck('branch_id')
            ->filter()
            ->count();

        $this->assertGreaterThan(1, $branchesWithSpend);
    }

    public function test_both_schedule_states_exist(): void
    {
        $schedules = RecurringExpense::withoutTenancy()->get();

        $this->assertNotEmpty($schedules);
        $this->assertNotNull($schedules->firstWhere('is_active', true));
        // "Active" looks like the only state when every row is.
        $this->assertNotNull($schedules->firstWhere('is_active', false), 'No paused schedule — the list shows one state only.');
    }

    public function test_budgets_cover_both_shapes_and_survive_a_retired_category(): void
    {
        $budgets = ExpenseBudget::withoutTenancy()->get();

        $this->assertNotEmpty($budgets, 'No budgets — the Budgets tab is empty in every demo tenant.');
        $this->assertNotNull($budgets->firstWhere(fn ($b): bool => $b->month === null), 'No standing budget.');
        $this->assertNotNull($budgets->firstWhere(fn ($b): bool => $b->month !== null), 'No month-specific budget.');

        // The case the Budgets tab used to drop: close a category mid-month and
        // the money already spent against it vanished off the screen.
        $retiredIds = ExpenseCategory::withoutTenancy()->where('is_active', false)->pluck('id');

        $this->assertNotEmpty($retiredIds, 'No retired expense category — the `closed` badge has nothing to mark.');
        $this->assertNotNull(
            $budgets->firstWhere(fn ($b): bool => $retiredIds->contains($b->expense_category_id)),
            'No budget survives against a retired category.',
        );
    }

    public function test_a_shift_was_opened_and_counted_out(): void
    {
        $closed = CashSession::withoutTenancy()->where('status', '!=', 'open')->first();

        $this->assertNotNull($closed, 'No closed shift — Day & banking → Shifts is empty.');
        $this->assertNotNull($closed->closed_at);
        // A drawer that balances exactly every time never shows what the
        // variance column is for.
        $this->assertNotEquals(0.0, (float) $closed->variance);
    }

    public function test_re_running_the_seeder_does_not_duplicate_the_money_block(): void
    {
        // The seeder's own promise. Branch creation moved OUTSIDE the
        // "already seeded" guard so a shop can gain a branch later — which is
        // exactly the shape that duplicates if it is not keyed properly.
        $before = [
            Branch::withoutTenancy()->count(),
            Expense::withoutTenancy()->count(),
            Income::withoutTenancy()->count(),
            ExpenseBudget::withoutTenancy()->count(),
            RecurringExpense::withoutTenancy()->count(),
            SaleReturn::withoutTenancy()->count(),
        ];

        $this->seed(DemoDataSeeder::class);

        $after = [
            Branch::withoutTenancy()->count(),
            Expense::withoutTenancy()->count(),
            Income::withoutTenancy()->count(),
            ExpenseBudget::withoutTenancy()->count(),
            RecurringExpense::withoutTenancy()->count(),
            SaleReturn::withoutTenancy()->count(),
        ];

        $this->assertSame($before, $after);
    }
}
