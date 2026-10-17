<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\CashSession;
use App\Models\City;
use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\Income;
use App\Models\IncomeCategory;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\DrawerMath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * B24 (the tester, money pass): the owner, looking at Main at the top of the
 * screen, paid a bill out of the Outlet drawer they had open. The cash left
 * the Outlet till, and the bill was filed to Main — so Main's books carried a
 * cost Main never paid, and the Outlet's day showed money gone with no bill.
 *
 * Money that leaves a drawer is filed at the drawer's place. Money that never
 * touched one (card, bank) is filed where the person is working, as before.
 */
class ACashBillIsFiledWhereTheCashWasTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private Branch $main;

    private Branch $outlet;

    private ExpenseCategory $bills;

    private IncomeCategory $misc;

    private CashSession $drawer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'business_type' => 'mart', 'timezone' => 'UTC',
            'city_id' => City::query()->create(['name' => 'Karachi', 'is_active' => true])->id,
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($shop)->create();
        $this->main = Branch::withoutTenancy()->where('tenant_id', $shop->id)->where('is_default', true)->firstOrFail();
        $this->outlet = Branch::withoutTenancy()->create(['tenant_id' => $shop->id, 'name' => 'Outlet', 'kind' => Branch::KIND_SHOP]);
        $this->bills = ExpenseCategory::withoutTenancy()->create(['tenant_id' => $shop->id, 'name' => 'Utilities', 'is_active' => true]);
        $this->misc = IncomeCategory::withoutTenancy()->create(['tenant_id' => $shop->id, 'name' => 'Miscellaneous', 'is_active' => true]);

        // The owner's drawer is open at the Outlet …
        $id = $this->at($this->outlet)->postJson('/api/v1/pos/session/open', ['opening_float' => 10000])->assertCreated()->json('data.id');
        $this->drawer = CashSession::withoutTenancy()->findOrFail($id);
        $this->assertSame($this->outlet->id, $this->drawer->branch_id);
    }

    public function test_a_bill_paid_out_of_a_drawer_is_filed_at_the_drawers_place(): void
    {
        // … while the screen is on Main.
        $cash = $this->expense(['amount' => 3000, 'payment_method' => 'cash']);
        $card = $this->expense(['amount' => 2000, 'payment_method' => 'card']);

        $this->assertSame($this->outlet->id, $cash['branch_id'], 'the cash left the Outlet till');
        $this->assertSame($this->main->id, $card['branch_id'], 'no drawer moved: filed where the person is working');
        $this->assertEquals(7000, DrawerMath::for($this->drawer->fresh())['expected_cash']);
    }

    public function test_money_taken_into_a_drawer_is_filed_there_too(): void
    {
        $income = $this->at($this->main)->postJson('/api/v1/incomes', [
            'income_category_id' => $this->misc->id, 'description' => 'Shutter rent', 'amount' => 5000,
            'payment_method' => 'cash', 'income_date' => now()->toDateString(),
        ])->assertCreated()->json('data');

        $this->assertSame($this->outlet->id, $income['branch_id']);
    }

    public function test_a_bank_payment_corrected_to_cash_follows_the_drawer(): void
    {
        $expense = $this->expense(['amount' => 3000, 'payment_method' => 'bank_transfer']);
        $this->assertSame($this->main->id, $expense['branch_id']);

        $this->at($this->main)->putJson("/api/v1/expenses/{$expense['id']}", [
            'expense_category_id' => $this->bills->id, 'description' => 'K-Electric bill', 'amount' => 3000,
            'payment_method' => 'cash', 'expense_date' => now()->toDateString(),
        ])->assertOk();
        $this->assertSame($this->outlet->id, Expense::withoutTenancy()->whereKey($expense['id'])->value('branch_id'));

        $income = $this->at($this->main)->postJson('/api/v1/incomes', [
            'income_category_id' => $this->misc->id, 'description' => 'Shutter rent', 'amount' => 5000,
            'payment_method' => 'bank_transfer', 'income_date' => now()->toDateString(),
        ])->assertCreated()->json('data');
        $this->at($this->main)->putJson("/api/v1/incomes/{$income['id']}", [
            'income_category_id' => $this->misc->id, 'description' => 'Shutter rent', 'amount' => 5000,
            'payment_method' => 'cash', 'income_date' => now()->toDateString(),
        ])->assertOk();
        $this->assertSame($this->outlet->id, Income::withoutTenancy()->whereKey($income['id'])->value('branch_id'));
    }

    /** @param array<string, mixed> $over */
    private function expense(array $over): array
    {
        return $this->at($this->main)->postJson('/api/v1/expenses', [
            'expense_category_id' => $this->bills->id, 'description' => 'K-Electric bill',
            'expense_date' => now()->toDateString(), ...$over,
        ])->assertCreated()->json('data');
    }

    private function at(Branch $place): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token)->withHeader('X-Branch-Id', $place->id);
    }
}
