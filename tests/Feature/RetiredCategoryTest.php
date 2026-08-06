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
 * What "switched off" means for a category.
 *
 * A category with entries filed under it cannot be deleted — the FK would null
 * out and a year of "Rent" would point at nothing, so every report from then on
 * is short a line it can no longer explain. It is RETIRED instead.
 *
 * Retiring only means something if it actually stops new entries, and nothing
 * checked it: not the entry forms, which offered every category regardless, and
 * not the server, which validated only tenant + not-deleted. So switching a
 * category off changed exactly one thing — whether it appeared in a filter,
 * where hiding it was the opposite of helpful, because a filter is how a
 * merchant reaches that history in the first place.
 *
 * Both halves are asserted here: nothing new goes in, everything already there
 * stays reachable.
 */
class RetiredCategoryTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private ExpenseCategory $retired;

    private ExpenseCategory $live;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->provisioned()->create();
        $this->owner = User::factory()->shopOwner($this->tenant)->create();

        $this->retired = ExpenseCategory::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Cooking Gas', 'is_active' => false,
        ]);
        $this->live = ExpenseCategory::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Rent', 'is_active' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('test-device', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function expensePayload(array $overrides = []): array
    {
        return array_merge([
            'expense_category_id' => $this->live->id,
            'description' => 'August rent',
            'amount' => 40000,
            'expense_date' => now()->toDateString(),
            'payment_method' => 'bank_transfer',
        ], $overrides);
    }

    public function test_a_retired_category_refuses_a_new_expense(): void
    {
        $this->actingAsUser($this->owner)
            ->postJson('/api/v1/expenses', $this->expensePayload([
                'expense_category_id' => $this->retired->id,
            ]))
            ->assertStatus(422)
            ->assertJsonStructure(['errors' => ['expense_category_id']]);

        $this->assertSame(0, Expense::withoutTenancy()->count());
    }

    public function test_a_live_category_still_takes_one(): void
    {
        $this->actingAsUser($this->owner)
            ->postJson('/api/v1/expenses', $this->expensePayload())
            ->assertCreated();
    }

    /**
     * The history keeps its home. Correcting the amount on a bill filed under a
     * since-retired category must not force a reclassification nobody asked
     * for — the category is unchanged, so the rule doesn't fire.
     */
    public function test_an_existing_entry_may_be_edited_without_moving_it(): void
    {
        $expense = Expense::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            'expense_category_id' => $this->retired->id,
            'description' => 'Gas cylinder',
            'amount' => 3000,
            'expense_date' => now()->toDateString(),
            'payment_method' => 'cash',
        ]);

        $this->actingAsUser($this->owner)
            ->putJson("/api/v1/expenses/{$expense->id}", $this->expensePayload([
                'expense_category_id' => $this->retired->id,
                'description' => 'Gas cylinder',
                'amount' => 3200,
                'payment_method' => 'cash',
            ]))
            ->assertOk();

        $this->assertEquals(3200, $expense->fresh()->amount);
    }

    /** But deliberately MOVING one into a retired category is still refused. */
    public function test_an_existing_entry_cannot_be_moved_into_a_retired_category(): void
    {
        $expense = Expense::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            'expense_category_id' => $this->live->id,
            'description' => 'August rent',
            'amount' => 40000,
            'expense_date' => now()->toDateString(),
            'payment_method' => 'bank_transfer',
        ]);

        $this->actingAsUser($this->owner)
            ->putJson("/api/v1/expenses/{$expense->id}", $this->expensePayload([
                'expense_category_id' => $this->retired->id,
            ]))
            ->assertStatus(422)
            ->assertJsonStructure(['errors' => ['expense_category_id']]);
    }

    /**
     * A retired category stays in the list, and stays FILTERABLE. Dropping it
     * from the list is how three years of gas bills became unreachable the day
     * the category was switched off.
     */
    public function test_a_retired_category_keeps_its_history_reachable(): void
    {
        Expense::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            'expense_category_id' => $this->retired->id,
            'description' => 'Gas cylinder',
            'amount' => 3000,
            'expense_date' => now()->toDateString(),
            'payment_method' => 'cash',
        ]);

        $listed = $this->actingAsUser($this->owner)->getJson('/api/v1/expense-categories')
            ->assertOk()->json('data');
        $this->assertContains($this->retired->id, array_column($listed, 'id'));

        $filtered = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/expenses?category_id[]='.$this->retired->id)
            ->assertOk()->json('data');

        $this->assertCount(1, $filtered);
        $this->assertSame('Gas cylinder', $filtered[0]['description']);
    }

    /**
     * The list says what is filed where, so a merchant knows which categories
     * can be deleted before clicking rather than after being refused.
     */
    public function test_the_category_list_carries_what_is_filed_under_each(): void
    {
        Expense::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            'expense_category_id' => $this->live->id,
            'description' => 'August rent', 'amount' => 40000,
            'expense_date' => now()->toDateString(), 'payment_method' => 'cash',
        ]);
        Expense::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            'expense_category_id' => $this->live->id,
            'description' => 'September rent', 'amount' => 42000,
            'expense_date' => now()->toDateString(), 'payment_method' => 'cash',
        ]);

        $rows = collect($this->actingAsUser($this->owner)->getJson('/api/v1/expense-categories')
            ->assertOk()->json('data'))->keyBy('id');

        $this->assertEquals(2, $rows[$this->live->id]['entries_count']);
        $this->assertEquals(82000, $rows[$this->live->id]['entries_total']);
        // An untouched category reports zero, not null — the UI draws a Delete
        // button off exactly this.
        $this->assertEquals(0, $rows[$this->retired->id]['entries_count']);
        $this->assertEquals(0, $rows[$this->retired->id]['entries_total']);
    }

    // ── Income is the mirror ──────────────────────────────────────────

    public function test_income_follows_the_same_rule(): void
    {
        $retired = IncomeCategory::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Old grant', 'is_active' => false,
        ]);
        $live = IncomeCategory::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Consulting', 'is_active' => true,
        ]);

        $payload = [
            'description' => 'Retainer', 'amount' => 50000,
            'income_date' => now()->toDateString(),
        ];

        $this->actingAsUser($this->owner)
            ->postJson('/api/v1/incomes', $payload + ['income_category_id' => $retired->id])
            ->assertStatus(422)
            ->assertJsonStructure(['errors' => ['income_category_id']]);

        $this->actingAsUser($this->owner)
            ->postJson('/api/v1/incomes', $payload + ['income_category_id' => $live->id])
            ->assertCreated();

        $this->assertSame(1, Income::withoutTenancy()->count());

        $rows = collect($this->actingAsUser($this->owner)->getJson('/api/v1/income-categories')
            ->assertOk()->json('data'))->keyBy('id');
        $this->assertEquals(1, $rows[$live->id]['entries_count']);
        $this->assertEquals(50000, $rows[$live->id]['entries_total']);
    }
}
