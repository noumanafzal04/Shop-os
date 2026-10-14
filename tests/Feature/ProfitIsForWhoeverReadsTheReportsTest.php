<?php

namespace Tests\Feature;

use App\Models\ExpenseCategory;
use App\Models\Tenant;
use App\Models\User;
use App\Support\StaffPresets;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * TODAY'S PROFIT AND EXPENSES ARE NOT THE TILL'S BUSINESS.
 *
 * Zari Clothing's cashier and stock keeper opened the dashboard and read the
 * day's profit and what the shop had spent — there was no check at all. The
 * user's rule (2026-10-13): owner, manager and accounts see them; a cashier
 * and a stock keeper do not unless they are given the permission.
 *
 * There are no roles here, only permissions: profit goes to whoever may read
 * the reports (`reports.view`), expenses to them and to whoever keeps the
 * expense book (`expenses.manage`). The SERVER leaves them out — null, not
 * zero — so a hidden tile is not a figure still sitting in the answer.
 */
class ProfitIsForWhoeverReadsTheReportsTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();

        // Yesterday and today, each with a sale and a bill on it, so every
        // figure is a real one — the change since yesterday included.
        $item = $this->as($this->owner)->postJson('/api/v1/products', [
            'name' => 'Lawn Suit', 'item_type' => 'physical_product', 'price' => 5000, 'cost' => 3000, 'track_inventory' => false,
        ])->assertCreated()->json('data');
        $bills = ExpenseCategory::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => 'Electricity'])->id;
        $this->travel(-1)->days();
        $this->aDay($item['id'], $bills, 900);
        $this->travelBack();
        $this->aDay($item['id'], $bills, 1200);
    }

    private function aDay(string $item, string $bills, float $spent): void
    {
        $this->as($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'items' => [['product_id' => $item, 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 5000,
        ])->assertCreated();
        $this->as($this->owner)->postJson('/api/v1/expenses', [
            'expense_category_id' => $bills, 'description' => 'Electricity', 'amount' => $spent,
            'expense_date' => now()->toDateString(), 'payment_method' => 'cash',
        ])->assertCreated();
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @param  list<string>  $permissions */
    private function staff(array $permissions): User
    {
        return User::factory()->create(['tenant_id' => $this->shop->id, 'role' => 'staff', 'permissions' => $permissions]);
    }

    private function preset(string $code): User
    {
        return $this->staff(collect(StaffPresets::all())->firstWhere('code', $code)['permissions']);
    }

    private function dashboard(User $user): array
    {
        return $this->as($user)->getJson('/api/v1/dashboard')->assertOk()->json('data');
    }

    private function assertSeesBoth(array $d, string $who): void
    {
        $this->assertSame(['profit' => true, 'expenses' => true], array_intersect_key($d['sees'], ['profit' => 0, 'expenses' => 0]), $who);
        $this->assertSame(1200.0, (float) $d['today']['expenses'], "{$who} was not sent the day's expenses");
        $this->assertIsNumeric($d['today']['profit'], "{$who} was not sent the day's profit");
        $this->assertIsNumeric($d['today']['deltas']['profit'], "{$who} was not sent the change in profit (or this fixture has no yesterday)");
        $this->assertIsNumeric($d['today']['deltas']['expenses']);
        $this->assertIsNumeric($d['period']['profit']);
        $this->assertIsNumeric(collect($d['sales_series'])->last()['profit']);
        $this->assertNotEmpty($d['expense_breakdown'], "{$who} was not sent where the money went");
    }

    private function assertSeesNeither(array $d, string $who, bool $sells = true): void
    {
        $this->assertSame(['profit' => false, 'expenses' => false], array_intersect_key($d['sees'], ['profit' => 0, 'expenses' => 0]), $who);
        foreach (['today', 'period'] as $block) {
            $this->assertNull($d[$block]['profit'], "{$who} was sent the {$block} profit");
            $this->assertNull($d[$block]['expenses'], "{$who} was sent the {$block} expenses");
            $this->assertNull($d[$block]['deltas']['profit'], "{$who} could work the profit out from its change");
            $this->assertNull($d[$block]['deltas']['expenses']);
        }
        foreach ($d['sales_series'] as $point) {
            $this->assertNull($point['profit'], "{$who} could read the profit off the chart");
            $this->assertNull($point['expenses'], "{$who} could read the expenses off the chart");
        }
        $this->assertSame([], $d['expense_breakdown'], "{$who} was sent where the money went");
        $this->assertSame([], $d['recent_expenses'], "{$who} was sent the expense book");
        $this->assertNull($d['books']);
        // What they DO need is still there — the day's sales to whoever rings
        // them; a stock keeper has no till and no money (pass 2, B39).
        $sells
            ? $this->assertSame(5000.0, (float) $d['today']['revenue'], "{$who} lost the day's sales with the profit")
            : $this->assertNull($d['today']['revenue'], "{$who} was sent the day's takings");
    }

    public function test_the_owner_sees_both(): void
    {
        $this->assertSeesBoth($this->dashboard($this->owner), 'the owner');
    }

    public function test_a_manager_and_the_accounts_desk_see_both(): void
    {
        $this->assertSeesBoth($this->dashboard($this->preset('manager')), 'a manager');
        $this->assertSeesBoth($this->dashboard($this->preset('accountant')), 'the accounts desk');
    }

    public function test_a_cashier_and_a_stock_keeper_see_neither(): void
    {
        $this->assertSeesNeither($this->dashboard($this->preset('cashier')), 'a cashier');
        $this->assertSeesNeither($this->dashboard($this->preset('stock_keeper')), 'a stock keeper', sells: false);
    }

    public function test_a_cashier_given_the_reports_sees_both(): void
    {
        // "Unless they are explicitly permitted": the permission, not the name.
        $this->assertSeesBoth($this->dashboard($this->staff(['sales.manage', 'reports.view'])), 'a cashier given the reports');
    }

    public function test_whoever_keeps_the_expense_book_sees_expenses_and_not_profit(): void
    {
        $d = $this->dashboard($this->staff(['expenses.manage']));

        $this->assertSame(['profit' => false, 'expenses' => true], array_intersect_key($d['sees'], ['profit' => 0, 'expenses' => 0]));
        $this->assertSame(1200.0, (float) $d['today']['expenses']);
        $this->assertNull($d['today']['profit']);
        $this->assertNotEmpty($d['expense_breakdown']);
    }
}
