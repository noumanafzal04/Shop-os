<?php

namespace Tests\Feature;

use App\Models\Income;
use App\Models\IncomeCategory;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * The Income half of the Expense & Income module + the unified Cashbook.
 * Mirrors ExpensesReportsTest; the cashbook tests prove derived sales revenue
 * and manual income never double-count.
 */
class IncomeCashbookTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private IncomeCategory $investment;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);
        $this->tenant = Tenant::factory()->provisioned()->create();
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->investment = IncomeCategory::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Owner Investment',
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('test-device', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function incomePayload(array $overrides = []): array
    {
        return array_merge([
            'income_category_id' => $this->investment->id,
            'description' => 'Capital injection',
            'amount' => 5000,
            'income_date' => now()->toDateString(),
        ], $overrides);
    }

    private function product(float $price = 100, float $cost = 60): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product',
            'name' => 'Widget', 'price' => $price, 'cost' => $cost, 'stock_quantity' => 50,
        ]);
    }

    // ── Income CRUD & edge cases (mirror expenses) ──────────────────

    public function test_income_created_and_listed(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/incomes', $this->incomePayload())
            ->assertCreated()
            ->assertJsonPath('data.description', 'Capital injection')
            ->assertJsonPath('data.category.name', 'Owner Investment');

        $this->actingAsUser($this->owner)->getJson('/api/v1/incomes')
            ->assertOk()
            ->assertJsonPath('meta.pagination.total', 1);
    }

    public function test_future_dated_income_rejected(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/incomes', $this->incomePayload([
            'income_date' => now()->addDay()->toDateString(),
        ]))->assertStatus(422)->assertJsonStructure(['errors' => ['income_date']]);
    }

    public function test_negative_and_zero_amounts_rejected(): void
    {
        foreach ([-100, 0] as $amount) {
            $this->actingAsUser($this->owner)->postJson('/api/v1/incomes', $this->incomePayload([
                'amount' => $amount,
            ]))->assertStatus(422)->assertJsonStructure(['errors' => ['amount']]);
        }
    }

    public function test_other_tenants_category_rejected(): void
    {
        $foreign = IncomeCategory::withoutTenancy()->create([
            'tenant_id' => Tenant::factory()->create()->id, 'name' => 'Their Income',
        ]);

        $this->actingAsUser($this->owner)->postJson('/api/v1/incomes', $this->incomePayload([
            'income_category_id' => $foreign->id,
        ]))->assertStatus(422);
    }

    public function test_duplicate_income_warns_but_saves(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/incomes', $this->incomePayload());
        $second = $this->actingAsUser($this->owner)->postJson('/api/v1/incomes', $this->incomePayload());

        $second->assertCreated();
        $this->assertStringContainsString('similar income', $second->json('meta.warnings.0'));
        $this->assertSame(2, Income::withoutTenancy()->count());
    }

    public function test_income_update_and_soft_delete(): void
    {
        $income = $this->actingAsUser($this->owner)
            ->postJson('/api/v1/incomes', $this->incomePayload())->json('data');

        $this->actingAsUser($this->owner)->putJson("/api/v1/incomes/{$income['id']}", $this->incomePayload([
            'amount' => 6000,
        ]))->assertOk()->assertJsonPath('data.amount', '6000.00');

        $this->actingAsUser($this->owner)->deleteJson("/api/v1/incomes/{$income['id']}")->assertOk();
        $this->assertSoftDeleted('incomes', ['id' => $income['id']]);
    }

    public function test_staff_without_expense_permission_blocked(): void
    {
        $staff = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE])->create();

        $this->actingAsUser($staff)->postJson('/api/v1/incomes', $this->incomePayload())
            ->assertStatus(403);
    }

    public function test_income_module_gated_by_expenses_feature(): void
    {
        // Income rides the SAME module gate as expenses — a sell-only shop
        // with the module off can't reach it.
        $stall = Tenant::factory()->create([
            'features' => ['products' => true, 'marketplace' => true, 'expenses' => false],
        ]);
        $stallOwner = User::factory()->shopOwner($stall)->create();

        $this->actingAsUser($stallOwner)->getJson('/api/v1/incomes')
            ->assertStatus(403)->assertJsonPath('meta.error_code', 'MODULE_DISABLED');
    }

    public function test_incomes_are_tenant_isolated(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/incomes', $this->incomePayload());

        $otherOwner = User::factory()->shopOwner(Tenant::factory()->provisioned()->create())->create();
        $this->assertSame(0, $this->actingAsUser($otherOwner)
            ->getJson('/api/v1/incomes')->json('meta.pagination.total'));
    }

    public function test_setup_seeds_default_income_categories(): void
    {
        // Business-type setup seeds a generic income-category template.
        $fresh = Tenant::factory()->create();
        app(\App\Actions\Shop\ApplyBusinessTypeDefaultsAction::class)->execute($fresh, 'mart');

        $names = IncomeCategory::withoutTenancy()->where('tenant_id', $fresh->id)->pluck('name');
        $this->assertTrue($names->contains('Other Income'));
        $this->assertTrue($names->contains('Owner Investment'));
        // Sales is DERIVED, never a seeded income bucket (would double-count).
        $this->assertFalse($names->contains('Sales'));
    }

    // ── Cashbook: derived money-in/out, NO double-count ─────────────

    public function test_cashbook_combines_derived_sales_and_manual_income_without_double_counting(): void
    {
        $product = $this->product(100, 60);

        // Sale today: 200 revenue in.
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 200,
            'items' => [['product_id' => $product->id, 'quantity' => 2]],
        ])->assertCreated()->json('data');

        // Manual OTHER income: 500 in.
        $this->actingAsUser($this->owner)->postJson('/api/v1/incomes', $this->incomePayload(['amount' => 500]));

        // Expense: 50 out.
        $rent = \App\Models\ExpenseCategory::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Rent',
        ]);
        $this->actingAsUser($this->owner)->postJson('/api/v1/expenses', [
            'expense_category_id' => $rent->id, 'description' => 'Rent',
            'amount' => 50, 'expense_date' => now()->toDateString(),
        ])->assertCreated();

        // Refund one unit: 100 out. Sale flips to partially_refunded but its
        // original revenue must STILL count on the in-side (money did come in).
        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
            'refund_method' => 'cash',
        ])->assertCreated();

        $cash = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/cashbook?period=daily')->assertOk()->json('data');

        $this->assertEquals(200, $cash['totals']['sales_revenue']);
        $this->assertEquals(500, $cash['totals']['other_income']);
        $this->assertEquals(700, $cash['totals']['money_in']); // 200 + 500, sale NOT counted as income
        $this->assertEquals(50, $cash['totals']['expenses']);
        $this->assertEquals(100, $cash['totals']['refunds']);
        $this->assertEquals(150, $cash['totals']['money_out']); // 50 + 100
        $this->assertEquals(550, $cash['totals']['net']);       // 700 − 150
        $this->assertEquals(0, $cash['opening_balance']);
        $this->assertEquals(550, $cash['closing_balance']);

        // Single daily bucket, running balance lands on the net.
        $this->assertCount(1, $cash['days']);
        $this->assertEquals(550, $cash['days'][0]['balance']);
    }

    public function test_cashbook_excludes_cancelled_sales_and_carries_an_opening_balance(): void
    {
        $product = $this->product(100, 60);

        // A sale YESTERDAY (opening position), plus income yesterday.
        $old = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 100,
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
        ])->json('data');
        \App\Models\Sale::withoutTenancy()->whereKey($old['id'])->update(['sold_at' => now()->subDay()]);

        // A CANCELLED sale today must never appear on either side.
        $cancelled = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 100,
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
        ])->json('data');
        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$cancelled['id']}/cancel")->assertOk();

        $cash = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/cashbook?period=daily')->assertOk()->json('data');

        // Yesterday's 100 is the opening balance; today has no live money.
        $this->assertEquals(100, $cash['opening_balance']);
        $this->assertEquals(0, $cash['totals']['sales_revenue']);
        $this->assertEquals(0, $cash['totals']['money_in']);
        $this->assertEquals(100, $cash['closing_balance']);
    }
}
