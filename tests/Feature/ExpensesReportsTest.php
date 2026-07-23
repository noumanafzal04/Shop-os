<?php

namespace Tests\Feature;

use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class ExpensesReportsTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private ExpenseCategory $rent;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);
        $this->tenant = Tenant::factory()->provisioned()->create();
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->rent = ExpenseCategory::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Rent',
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
            'expense_category_id' => $this->rent->id,
            'description' => 'Monthly rent',
            'amount' => 5000,
            'expense_date' => now()->toDateString(),
        ], $overrides);
    }

    // ── Expense CRUD & edge cases ───────────────────────────────────

    public function test_expense_created_and_listed(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/expenses', $this->expensePayload())
            ->assertCreated()
            ->assertJsonPath('data.description', 'Monthly rent')
            ->assertJsonPath('data.category.name', 'Rent');

        $this->actingAsUser($this->owner)->getJson('/api/v1/expenses')
            ->assertOk()
            ->assertJsonPath('meta.pagination.total', 1);
    }

    public function test_future_dated_expense_rejected(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/expenses', $this->expensePayload([
            'expense_date' => now()->addDay()->toDateString(),
        ]))->assertStatus(422)->assertJsonStructure(['errors' => ['expense_date']]);
    }

    public function test_negative_and_zero_amounts_rejected(): void
    {
        foreach ([-100, 0] as $amount) {
            $this->actingAsUser($this->owner)->postJson('/api/v1/expenses', $this->expensePayload([
                'amount' => $amount,
            ]))->assertStatus(422)->assertJsonStructure(['errors' => ['amount']]);
        }
    }

    public function test_missing_category_rejected(): void
    {
        $payload = $this->expensePayload();
        unset($payload['expense_category_id']);

        $this->actingAsUser($this->owner)->postJson('/api/v1/expenses', $payload)
            ->assertStatus(422)->assertJsonStructure(['errors' => ['expense_category_id']]);
    }

    public function test_other_tenants_category_rejected(): void
    {
        $otherTenant = Tenant::factory()->create();
        $foreignCategory = ExpenseCategory::withoutTenancy()->create([
            'tenant_id' => $otherTenant->id, 'name' => 'Their Rent',
        ]);

        $this->actingAsUser($this->owner)->postJson('/api/v1/expenses', $this->expensePayload([
            'expense_category_id' => $foreignCategory->id,
        ]))->assertStatus(422);
    }

    public function test_duplicate_expense_warns_but_saves(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/expenses', $this->expensePayload());

        $second = $this->actingAsUser($this->owner)->postJson('/api/v1/expenses', $this->expensePayload());

        $second->assertCreated();
        $this->assertStringContainsString('similar expense', $second->json('meta.warnings.0'));
        $this->assertSame(2, Expense::withoutTenancy()->count());
    }

    public function test_expense_update_and_soft_delete(): void
    {
        $expense = $this->actingAsUser($this->owner)
            ->postJson('/api/v1/expenses', $this->expensePayload())
            ->json('data');

        $this->actingAsUser($this->owner)->putJson("/api/v1/expenses/{$expense['id']}", $this->expensePayload([
            'amount' => 6000,
        ]))->assertOk()->assertJsonPath('data.amount', '6000.00');

        $this->actingAsUser($this->owner)->deleteJson("/api/v1/expenses/{$expense['id']}")
            ->assertOk();

        $this->assertSoftDeleted('expenses', ['id' => $expense['id']]);
    }

    public function test_staff_without_expense_permission_blocked(): void
    {
        $staff = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE])->create();

        $this->actingAsUser($staff)->postJson('/api/v1/expenses', $this->expensePayload())
            ->assertStatus(403);
    }

    public function test_expense_manager_module_can_be_switched_off(): void
    {
        // A sell-only shop (module disabled by admin) can't reach expenses,
        // even though the owner has the permission.
        $stall = Tenant::factory()->create([
            'features' => ['products' => true, 'marketplace' => true, 'expenses' => false],
        ]);
        $stallOwner = User::factory()->shopOwner($stall)->create();

        $this->actingAsUser($stallOwner)->getJson('/api/v1/expenses')
            ->assertStatus(403)->assertJsonPath('meta.error_code', 'MODULE_DISABLED');
        $this->actingAsUser($stallOwner)->postJson('/api/v1/expenses', $this->expensePayload())
            ->assertStatus(403)->assertJsonPath('meta.error_code', 'MODULE_DISABLED');
    }

    public function test_expenses_are_tenant_isolated(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/expenses', $this->expensePayload());

        $otherOwner = User::factory()->shopOwner(Tenant::factory()->provisioned()->create())->create();
        $this->assertSame(0, $this->actingAsUser($otherOwner)
            ->getJson('/api/v1/expenses')
            ->json('meta.pagination.total'));
    }

    public function test_dashboard_today_includes_expenses_in_net_profit(): void
    {
        // Sale: revenue 200, cogs 120.
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product',
            'name' => 'Widget', 'price' => 100, 'cost' => 60, 'stock_quantity' => 10,
        ]);
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $product->id, 'quantity' => 2]],
            'payment_method' => 'cash',
            'amount_paid' => 200,
        ]);

        // Expense today: 50.
        $this->actingAsUser($this->owner)->postJson('/api/v1/expenses', $this->expensePayload([
            'amount' => 50,
        ]));

        // Net profit = 200 - 120 - 50 = 30.
        $this->actingAsUser($this->owner)->getJson('/api/v1/dashboard')
            ->assertOk()
            ->assertJsonPath('data.today.expenses', 50)
            ->assertJsonPath('data.today.profit', 30);
    }

    // ── Reports ─────────────────────────────────────────────────────

    public function test_report_summary_totals_and_series(): void
    {
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product',
            'name' => 'Widget', 'price' => 100, 'cost' => 60, 'stock_quantity' => 50,
        ]);

        // Two sales today (300 revenue, 180 cogs) + one expense (100).
        foreach ([1, 2] as $qty) {
            $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
                'channel' => 'walk_in',
                'items' => [['product_id' => $product->id, 'quantity' => $qty]],
                'payment_method' => 'cash',
                'amount_paid' => $qty * 100,
            ]);
        }
        $this->actingAsUser($this->owner)->postJson('/api/v1/expenses', $this->expensePayload([
            'amount' => 100,
        ]));

        $report = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/reports/summary?period=daily')
            ->assertOk()
            ->json('data');

        $this->assertSame(2, $report['totals']['sales_count']);
        $this->assertEquals(300, $report['totals']['revenue']);
        $this->assertEquals(180, $report['totals']['cogs']);
        $this->assertEquals(120, $report['totals']['gross_profit']);
        $this->assertEquals(100, $report['totals']['expenses']);
        $this->assertEquals(20, $report['totals']['net_profit']);

        // Daily period = single zero-hole-free bucket.
        $this->assertCount(1, $report['series']);
        $this->assertEquals(300, $report['series'][0]['revenue']);

        // Top products + category breakdown.
        $this->assertSame('Widget', $report['top_products'][0]['name']);
        $this->assertSame(3, $report['top_products'][0]['units']);
        $this->assertSame('Rent', $report['expenses_by_category'][0]['category']);
    }

    public function test_cancelled_sales_excluded_from_reports(): void
    {
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product',
            'name' => 'Widget', 'price' => 100, 'stock_quantity' => 10,
        ]);
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
            'payment_method' => 'cash',
            'amount_paid' => 100,
        ])->json('data');

        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/cancel");

        $report = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/reports/summary?period=daily')
            ->json('data');

        $this->assertSame(0, $report['totals']['sales_count']);
        $this->assertEquals(0, $report['totals']['revenue']);
    }

    public function test_weekly_series_has_zero_filled_buckets(): void
    {
        $report = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/reports/summary?period=weekly')
            ->json('data');

        $this->assertCount(7, $report['series']); // full week, no holes
        $this->assertEquals(0, $report['series'][0]['revenue']);
    }

    public function test_custom_range_requires_valid_dates(): void
    {
        $this->actingAsUser($this->owner)
            ->getJson('/api/v1/reports/summary?period=custom&from=2026-07-10&to=2026-07-01')
            ->assertStatus(422);
    }

    public function test_reports_permission_required(): void
    {
        $staff = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE])->create();

        $this->actingAsUser($staff)->getJson('/api/v1/reports/summary?period=daily')
            ->assertStatus(403);
    }
}
