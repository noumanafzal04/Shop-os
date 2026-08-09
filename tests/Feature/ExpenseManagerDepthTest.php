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
use App\Models\Supplier;
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

    public function test_re_marking_a_bank_expense_as_cash_takes_it_out_of_the_drawer(): void
    {
        $session = $this->openShift(10000);
        $expense = $this->recordExpense(['amount' => 3000, 'payment_method' => 'bank_transfer']);

        $this->assertNull($expense['cash_movement_id']);

        // The correction direction nobody had covered. Cash → card removed the
        // movement and cash → cash amended it; card → cash did NOTHING, so the
        // row said the money came out of the till, the drawer had never heard
        // of it, and the shift closed 3,000 short with no explanation.
        $this->actingAsUser($this->owner)->putJson("/api/v1/expenses/{$expense['id']}", [
            'expense_category_id' => $this->utilities->id,
            'description' => 'K-Electric bill',
            'amount' => 3000,
            'payment_method' => 'cash',
            'expense_date' => now()->toDateString(),
        ])->assertOk();

        $movementId = Expense::withoutTenancy()->whereKey($expense['id'])->value('cash_movement_id');
        $this->assertNotNull($movementId);
        $this->assertSame('expense_out', CashMovement::withoutTenancy()->whereKey($movementId)->value('type'));
        $this->assertEquals(7000, DrawerMath::for($session->fresh())['expected_cash']);
    }

    public function test_correcting_to_cash_with_no_shift_open_says_the_drawer_was_untouched(): void
    {
        $expense = $this->recordExpense(['amount' => 3000, 'payment_method' => 'bank_transfer']);

        $warnings = $this->actingAsUser($this->owner)->putJson("/api/v1/expenses/{$expense['id']}", [
            'expense_category_id' => $this->utilities->id,
            'description' => 'K-Electric bill',
            'amount' => 3000,
            'payment_method' => 'cash',
            'expense_date' => now()->toDateString(),
        ])->assertOk()->json('meta.warnings');

        // Silence here is how a drawer and its books drift apart unnoticed.
        $this->assertStringContainsString('no shift open', implode(' ', $warnings ?? []));
        $this->assertNull(Expense::withoutTenancy()->whereKey($expense['id'])->value('cash_movement_id'));
    }

    public function test_re_marking_a_bank_income_as_cash_puts_it_in_the_drawer(): void
    {
        $session = $this->openShift(10000);

        $income = $this->actingAsUser($this->owner)->postJson('/api/v1/incomes', [
            'income_category_id' => $this->miscIncome->id,
            'description' => 'Rent received',
            'amount' => 5000,
            'payment_method' => 'bank_transfer',
            'income_date' => now()->toDateString(),
        ])->assertCreated()->json('data');

        $this->actingAsUser($this->owner)->putJson("/api/v1/incomes/{$income['id']}", [
            'income_category_id' => $this->miscIncome->id,
            'description' => 'Rent received',
            'amount' => 5000,
            'payment_method' => 'cash',
            'income_date' => now()->toDateString(),
        ])->assertOk();

        $this->assertNotNull(Income::withoutTenancy()->whereKey($income['id'])->value('cash_movement_id'));
        $this->assertEquals(15000, DrawerMath::for($session->fresh())['expected_cash']);
    }

    public function test_income_recorded_as_a_bank_transfer_leaves_the_drawer_alone(): void
    {
        $session = $this->openShift(10000);

        // The panel had no method picker at all, and the server defaults a
        // missing one to cash — so an owner logging a bank transfer while a
        // cashier was open handed them an overage they could not explain.
        $income = $this->actingAsUser($this->owner)->postJson('/api/v1/incomes', [
            'income_category_id' => $this->miscIncome->id,
            'description' => 'Owner injection by bank',
            'amount' => 20000,
            'payment_method' => 'bank_transfer',
            'income_date' => now()->toDateString(),
        ])->assertCreated()->json('data');

        $this->assertNull($income['cash_movement_id']);
        $this->assertEquals(10000, DrawerMath::for($session->fresh())['expected_cash']);
    }

    public function test_deleting_a_cash_expense_puts_the_money_back(): void
    {
        $session = $this->openShift(10000);
        $expense = $this->recordExpense(['amount' => 3000, 'payment_method' => 'cash']);

        $this->actingAsUser($this->owner)->deleteJson("/api/v1/expenses/{$expense['id']}")->assertOk();

        $this->assertEquals(10000, DrawerMath::for($session->fresh())['expected_cash']);
        $this->assertSame(0, CashMovement::withoutTenancy()->where('type', 'expense_out')->count());
    }

    public function test_a_real_expense_never_posts_to_a_practice_till(): void
    {
        $session = $this->openShift(10000, training: true);

        $response = $this->postExpense(['amount' => 3000, 'payment_method' => 'cash'])->assertCreated();
        $expense = $response->json('data');

        // There is no such thing as a practice expense — this row is in the
        // books, the cashbook and every report the moment it is filed. Posting
        // its cash leg to a till whose contents are thrown away loses the money
        // twice: the REAL drawer never learns the cash left, and the entry ends
        // up frozen by a practice shift the moment that shift is counted.
        $this->assertNull($expense['cash_movement_id']);
        $this->assertEquals(10000, DrawerMath::for($session->fresh())['expected_cash']);
        $this->assertSame(1, Expense::withoutTenancy()->count(), 'The expense itself is real and is kept.');
        $this->assertStringContainsString('practice till', implode(' ', $response->json('meta.warnings')));
    }

    public function test_cash_income_never_lands_in_a_practice_till_either(): void
    {
        $session = $this->openShift(10000, training: true);

        $response = $this->actingAsUser($this->owner)->postJson('/api/v1/incomes', [
            'income_category_id' => $this->miscIncome->id,
            'description' => 'Rent received',
            'amount' => 5000,
            'payment_method' => 'cash',
            'income_date' => now()->toDateString(),
        ])->assertCreated();

        $this->assertNull($response->json('data.cash_movement_id'));
        $this->assertEquals(10000, DrawerMath::for($session->fresh())['expected_cash']);
        $this->assertStringContainsString('practice till', implode(' ', $response->json('meta.warnings')));
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

    public function test_the_budget_list_says_which_of_the_two_ceilings_is_in_force(): void
    {
        $this->setBudget($this->rent, 50000);                                   // standing
        $this->setBudget($this->rent, 90000, month: now()->toDateString());     // this month only

        $rows = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/expenses/budgets')->assertOk()->json('data');

        // The effective figure alone cannot be edited: a box showing 90,000
        // with no way to know whether that is the standing number or this
        // month's override writes the wrong row half the time.
        $rent = collect($rows)->firstWhere('category', 'Rent');
        $this->assertEquals(90000, $rent['budget']);
        $this->assertEquals(50000, $rent['standing']);
        $this->assertTrue($rent['is_override']);

        $utilities = collect($rows)->firstWhere('category', 'Utilities');
        $this->assertNull($utilities['standing']);
        $this->assertFalse($utilities['is_override']);
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

    public function test_retiring_a_category_does_not_unspend_its_money(): void
    {
        // The page listed active categories and summed spend across ALL of
        // them, so closing a category mid-month made real expenditure vanish
        // from the screen — no row, no total, nothing to click. A shop
        // reconciling August against its bank would be short and have no way
        // to see where.
        $promo = $this->expenseCategory('Ramzan Promo');
        $this->recordExpense(['expense_category_id' => $promo->id, 'amount' => 12000, 'description' => 'Banners']);

        $promo->forceFill(['is_active' => false])->save();

        $row = collect($this->actingAsUser($this->owner)->getJson('/api/v1/expenses/budgets')->json('data'))
            ->firstWhere('category', 'Ramzan Promo');

        $this->assertNotNull($row, 'money spent must stay visible somewhere');
        $this->assertEquals(12000, $row['spent']);
        $this->assertTrue($row['is_retired'], 'and be marked as closed, not offered as somewhere to budget');
    }

    public function test_a_retired_category_nobody_spent_against_stays_off_the_page(): void
    {
        // The other half: retirement still means something. Without this the
        // fix above would grow the list forever with dead rows.
        $this->expenseCategory('Old Thing')->forceFill(['is_active' => false])->save();

        $rows = $this->actingAsUser($this->owner)->getJson('/api/v1/expenses/budgets')->json('data');

        $this->assertNull(collect($rows)->firstWhere('category', 'Old Thing'));
    }

    public function test_a_deleted_categorys_spend_is_still_accounted_for(): void
    {
        $gone = $this->expenseCategory('Deleted Later');
        $this->recordExpense(['expense_category_id' => $gone->id, 'amount' => 7000, 'description' => 'Signage']);

        $gone->delete();

        $row = collect($this->actingAsUser($this->owner)->getJson('/api/v1/expenses/budgets')->json('data'))
            ->firstWhere('category', 'Deleted Later');

        $this->assertNotNull($row);
        $this->assertEquals(7000, $row['spent']);
        $this->assertTrue($row['is_retired']);
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

    // ── The category list at scale ──────────────────────────────────

    public function test_the_category_list_still_answers_with_a_plain_array(): void
    {
        // The expense form's picker has always received a flat array. The
        // aggregates behind it changed shape; the contract must not.
        $this->recordExpense(['amount' => 1500, 'description' => 'Bill']);

        $rows = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/expense-categories')->assertOk()->json('data');

        $utilities = collect($rows)->firstWhere('name', 'Utilities');
        $rent = collect($rows)->firstWhere('name', 'Rent');

        $this->assertSame(1, $utilities['entries_count']);
        $this->assertEquals(1500, $utilities['entries_total']);
        // A category with nothing filed reports zero, not null and not absent.
        $this->assertSame(0, $rent['entries_count']);
        $this->assertEquals(0, $rent['entries_total']);
    }

    public function test_a_long_category_list_can_be_searched_and_paged(): void
    {
        // 150 categories is the shape this endpoint was reported failing at.
        foreach (range(1, 40) as $i) {
            $this->expenseCategory("Vendor {$i}");
        }

        $found = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/expense-categories?search=Vendor%201')->assertOk()->json('data');
        $this->assertNotEmpty($found);
        foreach ($found as $row) {
            $this->assertStringContainsString('Vendor 1', $row['name']);
        }

        $paged = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/expense-categories?per_page=10')->assertOk();
        $this->assertCount(10, $paged->json('data'));
        $this->assertSame(42, $paged->json('meta.pagination.total'));
    }

    // ── Who was paid ────────────────────────────────────────────────

    public function test_an_expense_records_and_reports_who_was_paid(): void
    {
        // supplier_id validated on the way in and loaded on the way out, with
        // nothing in between ever asserting it — so a column that looked wired
        // had no proof it was.
        $rafiq = Supplier::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Rafiq Traders', 'is_active' => true,
        ]);

        $this->recordExpense([
            'description' => 'Carton of packing tape',
            'amount' => 3200,
            'supplier_id' => $rafiq->id,
        ]);

        $row = $this->actingAsUser($this->owner)->getJson('/api/v1/expenses')->assertOk()->json('data.0');

        $this->assertSame($rafiq->id, $row['supplier_id']);
        $this->assertSame('Rafiq Traders', $row['supplier']['name']);
    }

    public function test_everything_paid_to_one_vendor_can_be_asked_for(): void
    {
        $rafiq = Supplier::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Rafiq Traders', 'is_active' => true,
        ]);
        $other = Supplier::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Bilal & Sons', 'is_active' => true,
        ]);

        $this->recordExpense(['description' => 'Tape', 'amount' => 3200, 'supplier_id' => $rafiq->id]);
        $this->recordExpense(['description' => 'Bags', 'amount' => 1800, 'supplier_id' => $rafiq->id]);
        $this->recordExpense(['description' => 'Boxes', 'amount' => 900, 'supplier_id' => $other->id]);
        $this->recordExpense(['description' => 'Tea', 'amount' => 300]);

        $body = $this->actingAsUser($this->owner)
            ->getJson("/api/v1/expenses?supplier_id={$rafiq->id}")->assertOk()->json();

        $this->assertCount(2, $body['data']);
        $this->assertEquals(5000, $body['meta']['totals']['total']);
    }

    public function test_another_shops_supplier_cannot_be_named_on_an_expense(): void
    {
        $stranger = Tenant::factory()->provisioned()->create();
        $theirs = Supplier::withoutTenancy()->create([
            'tenant_id' => $stranger->id, 'name' => 'Someone Else Ltd', 'is_active' => true,
        ]);

        $this->postExpense([
            'description' => 'Tape', 'amount' => 3200, 'supplier_id' => $theirs->id,
        ])->assertStatus(422);
    }

    public function test_a_posted_expense_says_which_schedule_it_came_from(): void
    {
        // The link was written from the day recurring expenses shipped and read
        // by nothing, so the books could not answer a question about their own
        // rows: is this second rent entry a duplicate, or the standing one?
        $template = $this->recurring(['next_due_on' => now()->toDateString()]);

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/expenses/recurring/{$template->id}/post", [])->assertCreated();

        $row = $this->actingAsUser($this->owner)->getJson('/api/v1/expenses')->assertOk()->json('data.0');

        $this->assertSame($template->id, $row['recurring_expense']['id']);
        $this->assertSame('Shop rent', $row['recurring_expense']['description']);
        $this->assertSame('monthly', $row['recurring_expense']['frequency']);
    }

    public function test_an_expense_somebody_typed_carries_no_schedule(): void
    {
        // Null is the answer just as often, and it has to be a clean null —
        // not a missing key the panel has to guess at.
        $this->recordExpense(['description' => 'Tea for the shop', 'amount' => 300]);

        $row = $this->actingAsUser($this->owner)->getJson('/api/v1/expenses')->assertOk()->json('data.0');

        $this->assertNull($row['recurring_expense']);
    }

    public function test_the_standing_costs_can_be_set_apart_from_the_decided_ones(): void
    {
        $template = $this->recurring(['next_due_on' => now()->toDateString()]);
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/expenses/recurring/{$template->id}/post", [])->assertCreated();
        $this->recordExpense(['description' => 'New kettle', 'amount' => 4500]);

        $recurring = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/expenses?source=recurring')->assertOk()->json('data');
        $manual = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/expenses?source=manual')->assertOk()->json('data');
        $fromThisTemplate = $this->actingAsUser($this->owner)
            ->getJson("/api/v1/expenses?recurring_expense_id={$template->id}")->assertOk()->json('data');

        $this->assertCount(1, $recurring);
        $this->assertSame('Shop rent', $recurring[0]['description']);
        $this->assertCount(1, $manual);
        $this->assertSame('New kettle', $manual[0]['description']);
        $this->assertCount(1, $fromThisTemplate);
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

    private function openShift(float $float, bool $training = false): CashSession
    {
        $id = $this->actingAsUser($this->owner)
            ->postJson('/api/v1/pos/session/open', array_filter([
                'opening_float' => $float,
                'is_training' => $training ?: null,
            ], fn ($v) => $v !== null))
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
