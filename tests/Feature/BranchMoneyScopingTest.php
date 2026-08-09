<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\CashSession;
use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\Product;
use App\Models\Sale;
use App\Models\SaleReturn;
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

    // ── Refunds ─────────────────────────────────────────────────────────

    /** Sell one Widget on $b and hand it straight back. Returns the sale id. */
    private function sellAndRefund(Branch $b, ?string $soldAt = null): string
    {
        $sale = $this->login($this->owner)->withHeaders(['X-Branch-Id' => $b->id])->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'items' => [['product_id' => $this->widget->id, 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 100,
        ])->assertCreated()->json('data');

        $this->login($this->owner)->withHeaders(['X-Branch-Id' => $b->id])
            ->postJson("/api/v1/sales/{$sale['id']}/returns", [
                'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
                'reason' => 'Faulty', 'refund_method' => 'cash',
            ])->assertCreated();

        if ($soldAt !== null) {
            // Backdate both legs together so the pair stays coherent.
            Sale::withoutTenancy()->where('id', $sale['id'])->update(['sold_at' => $soldAt]);
            SaleReturn::withoutTenancy()->where('sale_id', $sale['id'])->update(['returned_at' => $soldAt]);
        }

        return $sale['id'];
    }

    /** Today's ledger, focused on $b — or the owner's all-branches roll-up. */
    private function ledgerFor(?Branch $b): array
    {
        $req = $this->login($this->owner);
        if ($b !== null) {
            $req = $req->withHeaders(['X-Branch-Id' => $b->id]);
        }

        return $req->getJson('/api/v1/ledger?'.http_build_query([
            'period' => 'custom', 'from' => now()->toDateString(), 'to' => now()->toDateString(),
        ]))->assertOk()->json();
    }

    public function test_a_refund_belongs_to_the_branch_of_the_sale_it_reverses(): void
    {
        $this->sellAndRefund($this->other);

        $refund = SaleReturn::withoutTenancy()->where('tenant_id', $this->tenant->id)->firstOrFail();
        $this->assertSame($this->other->id, $refund->branch_id);
    }

    public function test_a_branch_ledger_does_not_show_another_branchs_refund(): void
    {
        // Before sale_returns carried a branch, this refund appeared on EVERY
        // branch's ledger — the money went out of Main and Gulberg both.
        $this->sellAndRefund($this->main);

        $rows = $this->ledgerFor($this->other)['data'];

        $this->assertSame([], array_values(array_filter($rows, fn ($r) => $r['type'] === 'refund')));
    }

    public function test_an_earlier_branchs_refund_stays_out_of_the_opening_balance(): void
    {
        // The worse half of the same bug. A refund BEFORE the window never
        // appears as a row, so it cannot be seen — it is silently folded into
        // the opening balance, and every running balance on the page inherits
        // it. That column is the only reason the screen exists.
        $this->sellAndRefund($this->main, now()->subMonth()->toDateTimeString());

        $this->assertEquals(0, $this->ledgerFor($this->other)['meta']['opening']);
    }

    public function test_an_owners_all_branches_ledger_still_shows_every_refund(): void
    {
        // Scoping must narrow a focused view, never hide money from the roll-up.
        $this->sellAndRefund($this->main);
        $this->sellAndRefund($this->other);

        $rows = $this->ledgerFor(null)['data'];

        $this->assertCount(2, array_filter($rows, fn ($r) => $r['type'] === 'refund'));
    }

    // ── The Cashbook and the Ledger are the same book ───────────────────

    /** Today's cashbook, focused on $b — or the owner's all-branches roll-up. */
    private function cashbookFor(?Branch $b): array
    {
        $req = $this->login($this->owner);
        if ($b !== null) {
            $req = $req->withHeaders(['X-Branch-Id' => $b->id]);
        }

        return $req->getJson('/api/v1/cashbook?period=daily')->assertOk()->json('data');
    }

    public function test_the_cashbook_and_the_ledger_report_the_same_money_for_a_branch(): void
    {
        // The complaint this whole change answers. The Ledger scoped by branch
        // and the Cashbook did not, so an owner looking at Gulberg was shown
        // two different answers to one question and had no way to tell which
        // was the shop's. They are the same book at two zoom levels; if they
        // can disagree, neither can be trusted.
        $this->recordExpense($this->main, 700);
        $this->recordExpense($this->other, 250);
        $this->sellAndRefund($this->main);

        $cashbook = $this->cashbookFor($this->other);
        $ledger = $this->ledgerFor($this->other);

        $this->assertEquals(250, $cashbook['totals']['expenses']);
        $this->assertEquals(250, $ledger['meta']['totals']['out'], 'the two screens must agree');
        $this->assertEquals(0, $cashbook['totals']['refunds'], "Main's refund is not Gulberg's money");
    }

    public function test_an_earlier_branchs_money_stays_out_of_the_cashbook_opening_balance(): void
    {
        $this->login($this->owner)->withHeaders(['X-Branch-Id' => $this->main->id])->postJson('/api/v1/expenses', [
            'expense_category_id' => $this->category->id,
            'description' => 'Last month rent',
            'amount' => 5000,
            'expense_date' => now()->subMonth()->toDateString(),
        ])->assertCreated();

        $this->assertEquals(0, $this->cashbookFor($this->other)['opening_balance']);
    }

    public function test_the_period_summary_is_scoped_to_the_focused_branch(): void
    {
        $this->recordExpense($this->main, 400);
        $this->recordExpense($this->other, 100);

        $focused = $this->login($this->owner)->withHeaders(['X-Branch-Id' => $this->other->id])
            ->getJson('/api/v1/reports/summary?period=daily')->assertOk()->json('data.totals');
        $all = $this->login($this->owner)
            ->getJson('/api/v1/reports/summary?period=daily')->assertOk()->json('data.totals');

        $this->assertEquals(100, $focused['expenses']);
        $this->assertEquals(500, $all['expenses']);
    }

    public function test_cash_session_belongs_to_the_branch_it_was_opened_on(): void
    {
        $this->login($this->owner)->withHeaders(['X-Branch-Id' => $this->other->id])
            ->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])->assertCreated();

        $session = CashSession::withoutTenancy()->where('tenant_id', $this->tenant->id)->first();
        $this->assertSame($this->other->id, $session->branch_id);
    }
}
