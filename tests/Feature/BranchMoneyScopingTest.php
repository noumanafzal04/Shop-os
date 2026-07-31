<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\CashSession;
use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Multi-branch money scoping: expenses, other income and cash-drawer shifts are
 * stamped with the OPERATING branch. A focused branch view (X-Branch-Id) reads
 * and reports only that branch's money; an owner's all-branches view rolls up.
 */
class BranchMoneyScopingTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Branch $main;

    private Branch $other;

    private ExpenseCategory $category;

    private Product $widget;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->provisioned()->create();
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->main = Branch::withoutTenancy()->where('tenant_id', $this->tenant->id)->where('is_default', true)->firstOrFail();
        $this->other = Branch::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Gulberg', 'is_default' => false, 'is_active' => true,
        ]);
        $this->category = ExpenseCategory::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Rent',
        ]);
        $this->widget = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'name' => 'Widget',
            'sku' => 'W-1', 'price' => 100, 'cost' => 60, 'track_inventory' => true, 'stock_quantity' => 100,
        ]);
        foreach ([$this->main, $this->other] as $b) {
            BranchStock::withoutTenancy()->create([
                'tenant_id' => $this->tenant->id, 'branch_id' => $b->id,
                'product_id' => $this->widget->id, 'variant_id' => null, 'quantity' => 50,
            ]);
        }
    }

    private function login(User $user): static
    {
        $this->defaultHeaders = [];
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function recordExpense(Branch $b, float $amount): void
    {
        $this->login($this->owner)->withHeaders(['X-Branch-Id' => $b->id])->postJson('/api/v1/expenses', [
            'expense_category_id' => $this->category->id,
            'description' => 'Shop rent',
            'amount' => $amount,
            'expense_date' => now()->toDateString(),
        ])->assertCreated();
    }

    public function test_expense_is_stamped_with_the_operating_branch(): void
    {
        $this->recordExpense($this->other, 500);

        $expense = Expense::withoutTenancy()->where('tenant_id', $this->tenant->id)->first();
        $this->assertSame($this->other->id, $expense->branch_id);
    }

    public function test_expense_list_is_scoped_to_the_focused_branch(): void
    {
        $this->recordExpense($this->main, 100);
        $this->recordExpense($this->other, 200);
        $this->recordExpense($this->other, 300);

        // Focused on Gulberg → only its 2 expenses.
        $focused = $this->login($this->owner)->withHeaders(['X-Branch-Id' => $this->other->id])
            ->getJson('/api/v1/expenses')->assertOk()->json('data');
        $this->assertCount(2, $focused);

        // Owner, all branches → all 3.
        $all = $this->login($this->owner)->getJson('/api/v1/expenses')->assertOk()->json('data');
        $this->assertCount(3, $all);
    }

    public function test_dashboard_deducts_only_the_focused_branch_expenses(): void
    {
        // Sell on Gulberg (revenue 100) + record a 30 expense there.
        $this->login($this->owner)->withHeaders(['X-Branch-Id' => $this->other->id])->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'items' => [['product_id' => $this->widget->id, 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 100,
        ])->assertCreated();
        $this->recordExpense($this->other, 30);
        $this->recordExpense($this->main, 999); // a Main expense must NOT bleed in

        $focused = $this->login($this->owner)->withHeaders(['X-Branch-Id' => $this->other->id])
            ->getJson('/api/v1/dashboard')->assertOk();

        $this->assertSame(30.0, (float) $focused->json('data.today.expenses'));

        // All-branches deducts both (30 + 999).
        $all = $this->login($this->owner)->getJson('/api/v1/dashboard')->assertOk();
        $this->assertSame(1029.0, (float) $all->json('data.today.expenses'));
    }

    public function test_cash_session_belongs_to_the_branch_it_was_opened_on(): void
    {
        $this->login($this->owner)->withHeaders(['X-Branch-Id' => $this->other->id])
            ->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])->assertCreated();

        $session = CashSession::withoutTenancy()->where('tenant_id', $this->tenant->id)->first();
        $this->assertSame($this->other->id, $session->branch_id);
    }
}
