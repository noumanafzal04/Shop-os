<?php

namespace Tests\Feature;

use App\Models\CashMovement;
use App\Models\CashSession;
use App\Models\City;
use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\Income;
use App\Models\IncomeCategory;
use App\Models\RecurringExpense;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\DrawerMath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * The Expense & Income Manager, second pass.
 *
 * What these tests really guard is the drawer. A shopkeeper pays the
 * electricity bill out of the till: before this, the expense was filed
 * perfectly and the drawer still expected the cash to be there, so the shift
 * closed on an unexplained short. Two of those a week and the variance report —
 * the one number a shop uses to detect theft — becomes noise.
 *
 * The rest is the arithmetic around that: only cash touches a drawer, only the
 * actor's own drawer, and once a shift is counted and closed, nothing may
 * rewrite it.
 */
class ExpenseManagerDepthTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private ExpenseCategory $utilities;

    private ExpenseCategory $rent;

    private IncomeCategory $miscIncome;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
            'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create(['name' => 'Owner']);

        $this->utilities = $this->expenseCategory('Utilities');
        $this->rent = $this->expenseCategory('Rent');
        $this->miscIncome = IncomeCategory::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Miscellaneous', 'is_active' => true,
        ]);
    }

    // ── The drawer ──────────────────────────────────────────────────

    public function test_a_cash_expense_takes_the_money_out_of_the_drawer(): void
    {
        $session = $this->openShift(10000);

        $expense = $this->recordExpense(['amount' => 3000, 'payment_method' => 'cash']);

        $this->assertNotNull($expense['cash_movement_id']);

        $movement = CashMovement::withoutTenancy()->whereKey($expense['cash_movement_id'])->firstOrFail();
        $this->assertSame('expense_out', $movement->type);
        $this->assertSame('out', $movement->direction);
        $this->assertEquals(3000, $movement->amount);
        $this->assertSame('expense', $movement->source_type);

        // The whole point: the drawer now expects 7,000, not 10,000. Without
        // this the shift closes on an unexplained 3,000 short.
        $this->assertEquals(7000, DrawerMath::for($session->fresh())['expected_cash']);
    }

    public function test_a_card_or_bank_expense_leaves_the_till_alone(): void
    {
        $session = $this->openShift(10000);

        $expense = $this->recordExpense(['amount' => 3000, 'payment_method' => 'bank_transfer']);

        // Real money left the business and none of it left the till. Posting it
        // to the drawer would invent a short that was never there.
        $this->assertNull($expense['cash_movement_id']);
        $this->assertEquals(10000, DrawerMath::for($session->fresh())['expected_cash']);
    }

    public function test_cash_income_lands_in_the_drawer(): void
    {
        $session = $this->openShift(10000);

        $income = $this->actingAsUser($this->owner)->postJson('/api/v1/incomes', [
            'income_category_id' => $this->miscIncome->id,
            'description' => 'Shop-front rent received',
            'amount' => 20000,
            'payment_method' => 'cash',
            'income_date' => now()->toDateString(),
        ])->assertCreated()->json('data');

        $this->assertNotNull($income['cash_movement_id']);
        $this->assertSame('income_in', CashMovement::withoutTenancy()->whereKey($income['cash_movement_id'])->value('type'));

        // An overage is the variance a shop is least likely to investigate, so
        // the error would simply accumulate.
        $this->assertEquals(30000, DrawerMath::for($session->fresh())['expected_cash']);
    }

    public function test_a_cash_expense_with_no_shift_open_is_recorded_and_says_so(): void
    {
        // The owner filing last week's bills at midnight has no drawer.
        // Inventing one — or reaching into whichever cashier is open — would
        // put a stranger's variance on their shift.
        $response = $this->actingAsUser($this->owner)->postJson('/api/v1/expenses', [
            'expense_category_id' => $this->utilities->id,
            'description' => 'K-Electric bill',
            'amount' => 8000,
            'payment_method' => 'cash',
            'expense_date' => now()->toDateString(),
        ])->assertCreated();

        $this->assertNull($response->json('data.cash_movement_id'));
        $this->assertStringContainsString('no shift open', implode(' ', $response->json('meta.warnings')));
    }

    public function test_editing_a_cash_expense_moves_the_drawer_with_it(): void
    {
        $session = $this->openShift(10000);
        $expense = $this->recordExpense(['amount' => 3000, 'payment_method' => 'cash']);

        $this->actingAsUser($this->owner)->putJson("/api/v1/expenses/{$expense['id']}", [
            'expense_category_id' => $this->utilities->id,
            'description' => 'K-Electric bill (corrected)',
            'amount' => 4500,
            'payment_method' => 'cash',
            'expense_date' => now()->toDateString(),
        ])->assertOk();

        $this->assertEquals(5500, DrawerMath::for($session->fresh())['expected_cash']);
    }

    public function test_re_marking_a_cash_expense_as_a_bank_transfer_returns_it_to_the_drawer(): void
    {
        $session = $this->openShift(10000);
        $expense = $this->recordExpense(['amount' => 3000, 'payment_method' => 'cash']);

        $this->actingAsUser($this->owner)->putJson("/api/v1/expenses/{$expense['id']}", [
            'expense_category_id' => $this->utilities->id,
            'description' => 'K-Electric bill',
            'amount' => 3000,
            'payment_method' => 'bank_transfer',
            'expense_date' => now()->toDateString(),
        ])->assertOk();

        // The cash never left the till, so the drawer entry goes with it.
        $this->assertEquals(10000, DrawerMath::for($session->fresh())['expected_cash']);
        $this->assertNull(Expense::withoutTenancy()->whereKey($expense['id'])->value('cash_movement_id'));
    }

    public function test_deleting_a_cash_expense_puts_the_money_back(): void
    {
        $session = $this->openShift(10000);
        $expense = $this->recordExpense(['amount' => 3000, 'payment_method' => 'cash']);

        $this->actingAsUser($this->owner)->deleteJson("/api/v1/expenses/{$expense['id']}")->assertOk();

        $this->assertEquals(10000, DrawerMath::for($session->fresh())['expected_cash']);
        $this->assertSame(0, CashMovement::withoutTenancy()->where('type', 'expense_out')->count());
    }

    public function test_an_expense_paid_from_a_closed_shift_can_no_longer_be_rewritten(): void
    {
        $this->openShift(10000);
        $expense = $this->recordExpense(['amount' => 3000, 'payment_method' => 'cash']);
        $this->closeShift(7000);

        // Somebody counted that drawer, signed the variance and went home.
        // Editing it now would rewrite a figure already reconciled.
        $this->actingAsUser($this->owner)->putJson("/api/v1/expenses/{$expense['id']}", [
            'expense_category_id' => $this->utilities->id,
            'description' => 'K-Electric bill',
            'amount' => 999,
            'payment_method' => 'cash',
            'expense_date' => now()->toDateString(),
        ])->assertStatus(409)->assertJsonPath('meta.error_code', 'EXPENSE_SETTLED');

        $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/expenses/{$expense['id']}")
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'EXPENSE_SETTLED');
    }

    // ── Budgets ─────────────────────────────────────────────────────

    public function test_a_budget_warns_but_never_refuses_the_record(): void
    {
        $this->setBudget($this->utilities, 5000);

        $first = $this->postExpense(['amount' => 4000, 'payment_method' => 'other']);
        $this->assertEmpty($first->json('meta.warnings') ?? []);

        // The bill arrived. Refusing to record it doesn't unspend the money —
        // it only stops the books matching the world.
        $second = $this->postExpense(['amount' => 2500, 'payment_method' => 'other'])->assertCreated();
        $this->assertStringContainsString('over its', implode(' ', $second->json('meta.warnings')));

        $this->assertSame(2, Expense::withoutTenancy()->where('tenant_id', $this->shop->id)->count());
    }

    public function test_a_month_specific_budget_overrides_the_standing_one(): void
    {
        $this->setBudget($this->rent, 50000);                                   // standing
        $this->setBudget($this->rent, 90000, month: now()->toDateString());     // this month only

        $rows = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/expenses/budgets')->assertOk()->json('data');

        $rent = collect($rows)->firstWhere('category', 'Rent');
        $this->assertEquals(90000, $rent['budget']);
    }

    public function test_an_unbudgeted_category_is_not_the_same_as_a_budget_of_zero(): void
    {
        $this->setBudget($this->rent, 0);

        $rows = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/expenses/budgets')->assertOk()->json('data');

        $this->assertEquals(0, collect($rows)->firstWhere('category', 'Rent')['budget']);
        $this->assertNull(collect($rows)->firstWhere('category', 'Utilities')['budget']);
    }

    public function test_a_budget_tracks_what_has_been_spent_this_month(): void
    {
        $this->setBudget($this->utilities, 10000);
        $this->postExpense(['amount' => 3500, 'payment_method' => 'other']);
        $this->postExpense(['amount' => 1500, 'payment_method' => 'other']);

        $row = collect($this->actingAsUser($this->owner)->getJson('/api/v1/expenses/budgets')->json('data'))
            ->firstWhere('category', 'Utilities');

        $this->assertEquals(5000, $row['spent']);
        $this->assertEquals(5000, $row['remaining']);
        $this->assertFalse($row['over']);
    }

    // ── Recurring ───────────────────────────────────────────────────

    public function test_a_recurring_expense_falls_due_and_is_posted_by_a_person(): void
    {
        $template = $this->recurring(['next_due_on' => now()->toDateString(), 'amount' => 25000]);

        $due = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/expenses/recurring?due=1')->assertOk();

        $this->assertCount(1, $due->json('data'));
        $this->assertSame(1, $due->json('meta.due_count'));

        // Nothing has been filed until a human confirms it — an entry that
        // appears because a clock ticked is an entry nobody checked.
        $this->assertSame(0, Expense::withoutTenancy()->count());

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/expenses/recurring/{$template->id}/post", ['payment_method' => 'other'])
            ->assertCreated();

        $this->assertSame(1, Expense::withoutTenancy()->count());
    }

    public function test_the_amount_can_be_corrected_at_the_moment_of_posting(): void
    {
        // Electricity never bills twice the same; a template that forces last
        // month's figure files a wrong one every month.
        $template = $this->recurring(['next_due_on' => now()->toDateString(), 'amount' => 25000]);

        $expense = $this->actingAsUser($this->owner)
            ->postJson("/api/v1/expenses/recurring/{$template->id}/post", [
                'amount' => 31450, 'payment_method' => 'other',
            ])->assertCreated()->json('data');

        $this->assertEquals(31450, $expense['amount']);
        $this->assertEquals(25000, $template->fresh()->amount, 'The template keeps its usual figure.');
    }

    public function test_a_late_posting_does_not_drag_the_schedule_later(): void
    {
        // Due on the 1st, posted on the 5th. The next one is still due on the
        // 1st — otherwise every late month pushes the schedule further adrift.
        $due = now()->startOfMonth()->subMonth();
        $template = $this->recurring(['next_due_on' => $due->toDateString(), 'frequency' => 'monthly']);

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/expenses/recurring/{$template->id}/post", ['payment_method' => 'other'])
            ->assertCreated();

        $this->assertSame(
            $due->copy()->addMonthNoOverflow()->toDateString(),
            $template->fresh()->next_due_on->toDateString(),
        );
    }

    public function test_a_template_cannot_be_posted_before_it_is_due(): void
    {
        $template = $this->recurring(['next_due_on' => now()->addWeek()->toDateString()]);

        // Posting early would advance the schedule past a period that hasn't
        // happened, quietly skipping it.
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/expenses/recurring/{$template->id}/post", [])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'RECURRING_NOT_DUE');
    }

    public function test_a_paused_template_is_neither_due_nor_postable(): void
    {
        $template = $this->recurring(['next_due_on' => now()->toDateString(), 'is_active' => false]);

        $this->assertSame(0, $this->actingAsUser($this->owner)
            ->getJson('/api/v1/expenses/recurring?due=1')->json('meta.due_count'));

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/expenses/recurring/{$template->id}/post", [])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'RECURRING_PAUSED');
    }

    public function test_a_posted_recurring_expense_still_moves_the_drawer(): void
    {
        $session = $this->openShift(60000);
        $template = $this->recurring(['next_due_on' => now()->toDateString(), 'amount' => 25000, 'payment_method' => 'cash']);

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/expenses/recurring/{$template->id}/post", [])
            ->assertCreated();

        $this->assertEquals(35000, DrawerMath::for($session->fresh())['expected_cash']);
    }

    // ── Categories ──────────────────────────────────────────────────

    public function test_categories_are_the_shops_own_and_seeded_from_its_business_type(): void
    {
        // The template is a starting point, never a fence: the owner adds their
        // own and the seeded ones behave identically.
        $mine = $this->actingAsUser($this->owner)
            ->postJson('/api/v1/expense-categories', ['name' => 'Chanda / Donations'])
            ->assertCreated()->json('data');

        $this->actingAsUser($this->owner)
            ->putJson("/api/v1/expense-categories/{$this->rent->id}", ['name' => 'Shop Rent'])
            ->assertOk();

        $this->assertSame('Shop Rent', $this->rent->fresh()->name);

        $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/expense-categories/{$mine['id']}")
            ->assertOk();
    }

    public function test_a_category_with_history_is_turned_off_rather_than_deleted(): void
    {
        $this->postExpense(['amount' => 1200, 'payment_method' => 'other']);

        // Deleting would null the FK and leave a year of "Utilities" pointing
        // at nothing — the money survives, its name doesn't.
        $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/expense-categories/{$this->utilities->id}")
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'CATEGORY_IN_USE');

        $this->actingAsUser($this->owner)
            ->putJson("/api/v1/expense-categories/{$this->utilities->id}", ['is_active' => false])
            ->assertOk();

        $this->assertFalse($this->utilities->fresh()->is_active);
    }

    public function test_an_income_category_with_history_is_protected_too(): void
    {
        Income::withoutTenancy()->create([
            'tenant_id' => $this->shop->id,
            'income_category_id' => $this->miscIncome->id,
            'description' => 'Scrap sale', 'amount' => 500,
            'income_date' => now()->toDateString(),
        ]);

        $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/income-categories/{$this->miscIncome->id}")
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'CATEGORY_IN_USE');
    }

    // ── Module gate ─────────────────────────────────────────────────

    public function test_a_shop_with_the_module_off_reaches_none_of_it(): void
    {
        $features = $this->shop->features;
        $features['expenses'] = false;
        $this->shop->forceFill(['features' => $features])->save();

        foreach (['/api/v1/expenses', '/api/v1/expenses/budgets', '/api/v1/expenses/recurring'] as $url) {
            $this->actingAsUser($this->owner)->getJson($url)
                ->assertForbidden()
                ->assertJsonPath('meta.error_code', 'MODULE_DISABLED');
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────

    private function expenseCategory(string $name): ExpenseCategory
    {
        return ExpenseCategory::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => $name, 'is_active' => true,
        ]);
    }

    /** @param array<string, mixed> $overrides */
    private function postExpense(array $overrides = []): TestResponse
    {
        return $this->actingAsUser($this->owner)->postJson('/api/v1/expenses', [
            'expense_category_id' => $this->utilities->id,
            'description' => 'K-Electric bill',
            'expense_date' => now()->toDateString(),
            ...$overrides,
        ]);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function recordExpense(array $overrides = []): array
    {
        return $this->postExpense($overrides)->assertCreated()->json('data');
    }

    private function setBudget(ExpenseCategory $category, float $amount, ?string $month = null): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/expenses/budgets', array_filter([
            'expense_category_id' => $category->id,
            'amount' => $amount,
            'month' => $month,
        ], fn ($v) => $v !== null))->assertOk();
    }

    /** @param array<string, mixed> $overrides */
    private function recurring(array $overrides = []): RecurringExpense
    {
        return RecurringExpense::withoutTenancy()->create([
            'tenant_id' => $this->shop->id,
            'expense_category_id' => $this->rent->id,
            'description' => 'Shop rent',
            'amount' => 25000,
            'payment_method' => 'other',
            'frequency' => 'monthly',
            'next_due_on' => now()->toDateString(),
            'is_active' => true,
            ...$overrides,
        ]);
    }

    private function openShift(float $float): CashSession
    {
        $id = $this->actingAsUser($this->owner)
            ->postJson('/api/v1/pos/session/open', ['opening_float' => $float])
            ->assertCreated()->json('data.id');

        return CashSession::withoutTenancy()->findOrFail($id);
    }

    private function closeShift(float $counted): void
    {
        $this->actingAsUser($this->owner)
            ->postJson('/api/v1/pos/session/close', ['counted_cash' => $counted])
            ->assertOk();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
