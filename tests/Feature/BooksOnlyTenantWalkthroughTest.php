<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\City;
use App\Models\Expense;
use App\Models\ExpenseBudget;
use App\Models\ExpenseCategory;
use App\Models\Supplier;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * The books-only shop, walked end to end — the QA pass for a `finance` tenant.
 *
 * This tenant is the odd one out: no catalog, no stock, no till. Its entire
 * product is the Expense & Income Manager, which means the seams that carry it
 * are the ones nobody else exercises. Every other suite tests one of those
 * modules on a shop that also sells things, so a link that only a books-only
 * tenant depends on can rot without a single test going red.
 *
 * The chains walked here, and what each one is guarding:
 *
 *   modules → routes        the catalog and the till are REFUSED, not empty
 *   category → books        retiring a category must not unspend its money
 *   entry → paper           supplier, note, method and the receipt behind it
 *   filters → totals        the figure under a slice belongs to that slice
 *   income → ledger         money in that is not a sale still reaches the book
 *   schedule → expense      a posted template stamps its lineage on the row
 *   budget → warning        the month override is the ceiling actually used
 *   branch → two screens    the Cashbook and the Ledger are one book
 *   book → CSV              what the accountant gets is what was on screen
 *
 * Time is frozen mid-month on purpose: half of this file is about which month
 * a figure lands in, and a suite that only fails on the 1st and the 31st is a
 * suite nobody trusts.
 */
class BooksOnlyTenantWalkthroughTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        Storage::fake('public');
        // Receipts moved off the public disk — see ReceiptPrivacyTest.
        Storage::fake('local');
        Carbon::setTestNow('2026-03-12 09:00:00');

        [$this->shop, $this->owner] = $this->booksOnlyShop();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    // ── modules → routes ────────────────────────────────────────────

    public function test_the_shop_is_refused_a_catalog_and_a_till_and_still_keeps_its_books(): void
    {
        // The whole reason `finance` exists as its own type. Its feature map has
        // to be expenses and nothing else — every other type turns POS on by
        // default, and this one deliberately does not.
        foreach (['products', 'services', 'inventory', 'pos', 'dine_in', 'marketplace', 'delivery'] as $off) {
            $this->assertFalse($this->shop->featureEnabled($off), "A books-only shop must not have {$off}.");
        }
        $this->assertTrue($this->shop->featureEnabled('expenses'));

        // The door is shut, not the room empty. An empty catalog reads as "a
        // shop that has not added products yet" and sends the owner looking for
        // an Add button that should never have been drawn.
        foreach (['/api/v1/products', '/api/v1/pos/session', '/api/v1/pos/bootstrap', '/api/v1/suppliers'] as $url) {
            $this->as($this->owner)->getJson($url)
                ->assertForbidden()
                ->assertJsonPath('meta.error_code', 'MODULE_DISABLED');
        }

        // And no money can be taken through a till this shop does not have.
        $this->as($this->owner)->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])
            ->assertForbidden()->assertJsonPath('meta.error_code', 'MODULE_DISABLED');
        $this->as($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'items' => [], 'payment_method' => 'cash',
        ])->assertForbidden()->assertJsonPath('meta.error_code', 'MODULE_DISABLED');

        // The sale HISTORY is refused too, not merely empty. Fixed 2026-08-10:
        // the reads carried the sales.manage PERMISSION and no module gate, so a
        // shop that can never make a sale was handed a Sales screen answering
        // "you have no sales" — which describes a shop with no trade rather than
        // a shop without the feature, and is the same wrong answer an empty
        // catalog would be.
        $this->as($this->owner)->getJson('/api/v1/sales')
            ->assertForbidden()
            ->assertJsonPath('meta.error_code', 'MODULE_DISABLED');

        // The books themselves are open for business.
        $this->as($this->owner)->getJson('/api/v1/expenses')->assertOk();
        $this->as($this->owner)->getJson('/api/v1/incomes')->assertOk();
        $this->as($this->owner)->getJson('/api/v1/cashbook?period=monthly')->assertOk();
        $this->as($this->owner)->getJson('/api/v1/ledger?period=monthly')->assertOk();
    }

    // ── who was paid ────────────────────────────────────────────────

    public function test_a_books_only_shop_can_name_who_it_paid_and_who_paid_it(): void
    {
        // The gap this closes: expenses.supplier_id is validated and the list
        // renders a "Paid to" column from it, but every /suppliers route rides
        // the INVENTORY module — which a books-only shop does not have. So the
        // one tenant whose entire product is the expense list was the only one
        // that could not record who it paid.
        //
        // Fixed with a payee rather than by widening the supplier gate. Those
        // are two different things: a supplier is a stock-chain party with
        // payables and a running balance; a landlord is not one, and neither is
        // WAPDA. Widening the gate was tried and reverted — most trades carry
        // `expenses`, so it opened the vendor directory to everyone and broke
        // six module-isolation tests that exist on purpose.
        $category = $this->category('Rent');

        // The directory itself is still shut, which is the point.
        $this->as($this->owner)->getJson('/api/v1/suppliers')->assertForbidden();

        $expense = $this->as($this->owner)->postJson('/api/v1/expenses', [
            'expense_category_id' => $category,
            'payee' => 'Malik Property Management',
            'description' => 'Shop rent — August',
            'amount' => 45000,
            'expense_date' => now()->toDateString(),
            'payment_method' => 'bank_transfer',
        ])->assertCreated()->json('data');

        $this->assertSame('Malik Property Management', $expense['payee'], 'The payee was accepted and not stored.');

        // And it survives the round trip to the screen a book-keeper reads.
        $listed = collect($this->as($this->owner)->getJson('/api/v1/expenses')->assertOk()->json('data'))
            ->firstWhere('id', $expense['id']);

        $this->assertSame('Malik Property Management', $listed['payee']);

        // The other side of the same gap.
        $income = $this->as($this->owner)->postJson('/api/v1/incomes', [
            'income_category_id' => $this->as($this->owner)
                ->postJson('/api/v1/income-categories', ['name' => 'Client fees'])
                ->assertCreated()->json('data.id'),
            'payer' => 'Sohail Traders',
            'description' => 'Invoice 4471 settled',
            'amount' => 62000,
            'income_date' => now()->toDateString(),
            'payment_method' => 'bank_transfer',
        ])->assertCreated()->json('data');

        $this->assertSame('Sohail Traders', $income['payer'], 'Income still cannot say who paid it.');
    }

    // ── category → books ────────────────────────────────────────────

    public function test_a_category_is_renamed_then_retired_and_its_spend_survives_both(): void
    {
        // Categories are the only structure a books-only shop has, so all three
        // states have to hold at once: a rename must reach entries already
        // filed, a retirement must stop new ones, and neither may make money
        // that was really spent disappear off the page.
        $typo = $this->as($this->owner)->postJson('/api/v1/expense-categories', [
            'name' => 'Genarator Diesel',
        ])->assertCreated()->json('data.id');

        $this->expense(['expense_category_id' => $typo, 'description' => 'Diesel — 40 litres', 'amount' => 12000]);

        $this->as($this->owner)->putJson("/api/v1/expense-categories/{$typo}", [
            'name' => 'Generator Diesel',
        ])->assertOk();

        // The name is joined, not copied — an entry filed under the old spelling
        // must print the new one, or the books show two categories where the
        // shop only ever had one.
        $ledgerRow = $this->ledgerRows()[0];
        $this->assertSame('Generator Diesel', $ledgerRow['category']);
        $this->assertEquals(12000, $ledgerRow['out']);

        $this->as($this->owner)->putJson("/api/v1/expense-categories/{$typo}", [
            'is_active' => false,
        ])->assertOk();

        // Retired means retired: nothing new goes in.
        $this->postExpense(['expense_category_id' => $typo, 'description' => 'More diesel', 'amount' => 3000])
            ->assertStatus(422)
            ->assertJsonStructure(['errors' => ['expense_category_id']]);

        // And the 12,000 already spent is still there, on every screen that
        // reports it. Filtering the budgets page to ACTIVE categories while the
        // spend map still counted retired ones is how a shop reconciling March
        // against its bank ended up short with nothing to click.
        $row = $this->budgetRow('Generator Diesel');
        $this->assertTrue($row['is_retired']);
        $this->assertEquals(12000, $row['spent'], 'Retiring a category unspent its money.');

        $this->assertEquals(12000, $this->cashbook()['totals']['expenses']);
        $this->assertEquals(12000, $this->ledger()['meta']['totals']['out']);
    }

    // ── entry → paper ───────────────────────────────────────────────

    public function test_an_expense_carries_who_where_how_and_the_bill_behind_it(): void
    {
        // Everything the entry form offers has to survive the round trip. Each
        // of these is a column that was writable and readable without anything
        // ever proving the two ends were connected.
        $rent = $this->category('Rent');

        // GAP: a books-only tenant cannot create a supplier through the API at
        // all — /suppliers is gated on the `inventory` module, which this type
        // has off by design — yet the expense form's "Paid to" field validates
        // against that same table. So the one tenant whose whole product is the
        // expense list is the one that can never fill in who it paid. Seeded
        // directly here so the rest of the chain can be walked.
        $this->as($this->owner)->postJson('/api/v1/suppliers', ['name' => 'Rafiq Traders'])
            ->assertForbidden();
        $rafiq = Supplier::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Rafiq Traders', 'is_active' => true,
        ]);

        $main = $this->branch('Main');

        $id = $this->as($this->owner)->withHeaders(['X-Branch-Id' => $main->id])
            ->postJson('/api/v1/expenses', [
                'expense_category_id' => $rent,
                'supplier_id' => $rafiq->id,
                'description' => 'Office rent — March',
                'reference' => 'INV-2026-0312',
                'notes' => 'Paid to the landlord in person, receipt attached',
                'amount' => 85000,
                'payment_method' => 'bank_transfer',
                'expense_date' => now()->toDateString(),
            ])->assertCreated()->json('data.id');

        $this->as($this->owner)->post("/api/v1/expenses/{$id}/attachment", [
            'file' => UploadedFile::fake()->image('bank-slip.jpg'),
        ], ['Accept' => 'application/json'])->assertOk();

        $row = $this->as($this->owner)->getJson('/api/v1/expenses')->assertOk()->json('data.0');

        $this->assertSame($id, $row['id']);
        $this->assertSame('Rafiq Traders', $row['supplier']['name'], 'The book cannot say who was paid.');
        $this->assertSame('INV-2026-0312', $row['reference']);
        $this->assertSame('Paid to the landlord in person, receipt attached', $row['notes']);
        $this->assertSame('bank_transfer', $row['payment_method']);
        $this->assertSame($main->id, $row['branch_id']);
        $this->assertEquals(85000, $row['amount']);

        // A written-but-unreadable receipt is the same bug wearing a hat: the
        // file is on disk, the row says there is none, and the argument the
        // photo exists to settle cannot be settled.
        $this->assertNotNull($row['attachment_url'], 'The receipt was stored but the row cannot point at it.');
        Storage::disk('local')->assertExists(
            Expense::withoutTenancy()->findOrFail($id)->attachment_path,
        );
    }

    // ── filters → totals ────────────────────────────────────────────

    public function test_every_way_of_asking_narrows_the_book_and_the_figure_underneath_it(): void
    {
        // Four different questions over one book. The trap is the TOTAL: a
        // filtered page with an unfiltered figure under it is a number nobody
        // can reconcile against the rows they can see, and it is the number the
        // merchant reads first.
        $rent = $this->category('Rent');
        $fuel = $this->category('Fuel');
        $rafiq = Supplier::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Rafiq Traders', 'is_active' => true,
        ]);

        $this->expense(['expense_category_id' => $rent, 'description' => 'February rent', 'amount' => 80000,
            'expense_date' => '2026-02-20', 'payment_method' => 'bank_transfer']);
        $this->expense(['expense_category_id' => $rent, 'description' => 'March rent', 'amount' => 85000,
            'expense_date' => '2026-03-02', 'payment_method' => 'bank_transfer']);
        $this->expense(['expense_category_id' => $fuel, 'description' => 'Diesel', 'amount' => 6000,
            'expense_date' => '2026-03-05', 'payment_method' => 'cash', 'supplier_id' => $rafiq->id]);
        $this->expense(['expense_category_id' => $fuel, 'description' => 'Petrol', 'amount' => 4000,
            'expense_date' => '2026-03-12', 'payment_method' => 'cash']);

        // A custom window, the way the date-range picker sends it. The last day
        // of the window is INSIDE it — a date-cast column stores "…-10 00:00:00"
        // and sorts after a bare "…-10", which silently drops the final day.
        $window = $this->expenses(['from' => '2026-03-01', 'to' => '2026-03-10']);
        $this->assertEquals(91000, $window['meta']['totals']['total'], 'The custom range is not the range asked for.');
        $this->assertSame(2, $window['meta']['totals']['count']);

        // One category, across the whole book — the February rent counts here
        // and did not count above.
        $byCategory = $this->expenses(['category_id' => $rent]);
        $this->assertEquals(165000, $byCategory['meta']['totals']['total']);

        // "What have we been paying in cash?" — the question that finds the
        // spending nobody has a bank line for.
        $byMethod = $this->expenses(['payment_method' => 'cash']);
        $this->assertEquals(10000, $byMethod['meta']['totals']['total']);

        // "What have we paid Rafiq Traders?"
        $bySupplier = $this->expenses(['supplier_id' => $rafiq->id]);
        $this->assertSame(1, $bySupplier['meta']['totals']['count']);
        $this->assertEquals(6000, $bySupplier['meta']['totals']['total']);

        // Two questions at once must intersect, not replace one another.
        $both = $this->expenses(['category_id' => $fuel, 'from' => '2026-03-01', 'to' => '2026-03-10']);
        $this->assertEquals(6000, $both['meta']['totals']['total']);
    }

    // ── income → ledger ─────────────────────────────────────────────

    public function test_money_in_that_is_not_a_sale_is_categorised_evidenced_and_reaches_the_book(): void
    {
        // A consultant's earnings are Income rows, never Sales. If that side of
        // the module does not reach the Ledger, the shop's own book shows only
        // what it spent — every month a loss, and the sign is wrong.
        $fees = $this->as($this->owner)->postJson('/api/v1/income-categories', [
            'name' => 'Consulting fees',
        ])->assertCreated()->json('data.id');

        $id = $this->as($this->owner)->postJson('/api/v1/incomes', [
            'income_category_id' => $fees,
            'description' => 'Retainer — March',
            'reference' => 'BILL-114',
            'amount' => 300000,
            'payment_method' => 'bank_transfer',
            'income_date' => now()->toDateString(),
        ])->assertCreated()->json('data.id');

        $this->as($this->owner)->post("/api/v1/incomes/{$id}/attachment", [
            'file' => UploadedFile::fake()->image('deposit-slip.jpg'),
        ], ['Accept' => 'application/json'])->assertOk();

        $listed = $this->as($this->owner)->getJson('/api/v1/incomes')->assertOk()->json('data.0');
        $this->assertNotNull($listed['attachment_url'], 'Income had the column and no way to read it back.');

        // The far end: the ledger builds its rows from a UNION of four tables,
        // and income is the leg only this tenant type leans on.
        $row = collect($this->ledgerRows())->firstWhere('type', 'income');

        $this->assertNotNull($row, 'A recorded income never reached the ledger.');
        $this->assertSame('Consulting fees', $row['category']);
        $this->assertSame('BILL-114', $row['reference']);
        $this->assertEquals(300000, $row['in']);
        $this->assertEquals(0, $row['out']);

        // And the summary screen above it says the same thing.
        $this->assertEquals(300000, $this->cashbook()['totals']['other_income']);
    }

    // ── schedule → expense ──────────────────────────────────────────

    public function test_a_monthly_schedule_posts_a_real_expense_that_says_where_it_came_from(): void
    {
        // Rent, salaries, the internet bill. Nothing is filed until a person
        // confirms the figure — but once filed it is an ordinary expense, and
        // it has to be traceable back to the schedule or the books cannot answer
        // "is this second rent row a duplicate, or the standing one?".
        $rent = $this->category('Rent');

        $template = $this->as($this->owner)->postJson('/api/v1/expenses/recurring', [
            'expense_category_id' => $rent,
            'description' => 'Shop rent',
            'amount' => 85000,
            'payment_method' => 'bank_transfer',
            'frequency' => 'monthly',
            'next_due_on' => now()->toDateString(),
        ])->assertCreated()->json('data.id');

        $due = $this->as($this->owner)->getJson('/api/v1/expenses/recurring?due=1')->assertOk();
        $this->assertSame(1, $due->json('meta.due_count'));
        $this->assertSame(0, Expense::withoutTenancy()->count(), 'A clock ticking is not a bill anybody checked.');

        // The landlord raised it. The amount is exactly the part that moves.
        $this->as($this->owner)->postJson("/api/v1/expenses/recurring/{$template}/post", [
            'amount' => 89500,
        ])->assertCreated();

        $posted = Expense::withoutTenancy()->where('tenant_id', $this->shop->id)->first();

        $this->assertNotNull($posted, 'The schedule was posted and no expense reached the books.');
        $this->assertEquals(89500, $posted->amount, 'The corrected figure was not the one filed.');
        $this->assertSame($template, $posted->recurring_expense_id, 'The posted expense lost its lineage.');

        $row = $this->as($this->owner)->getJson('/api/v1/expenses?source=recurring')->assertOk();
        $this->assertSame(1, $row->json('meta.totals.count'));
        $this->assertEquals(89500, $row->json('meta.totals.total'));
        $this->assertSame('Shop rent', $row->json('data.0.recurring_expense.description'));

        // A posted row is a real expense, so it lands in the books like any
        // other — and the schedule moves on by exactly one month.
        $this->assertEquals(89500, $this->cashbook()['totals']['expenses']);
        $this->assertEquals(89500, $this->budgetRow('Rent')['spent']);
        $this->assertStringStartsWith('2026-04-12', (string) $this->as($this->owner)
            ->getJson('/api/v1/expenses/recurring')->json('data.0.next_due_on'));
    }

    // ── budget → warning ────────────────────────────────────────────

    public function test_this_months_ceiling_beats_the_standing_one_everywhere_it_is_read(): void
    {
        // One figure all year, except the month the annual licence falls due.
        // The override is only worth having if EVERY reader picks it — the model,
        // the budgets page and the sentence shown at the moment of entry. A
        // reader that quietly falls back to the standing number turns a normal
        // month into a false alarm, and false alarms get ignored.
        $rent = $this->category('Rent');

        $this->setBudget($rent, 50000);                                  // standing
        $this->setBudget($rent, 90000, month: now()->toDateString());    // March only

        $march = ExpenseBudget::ceilingFor($rent, Carbon::parse('2026-03-01'), $this->branch('Main')->id);
        $april = ExpenseBudget::ceilingFor($rent, Carbon::parse('2026-04-01'), $this->branch('Main')->id);

        $this->assertEquals(90000, $march, 'The month override lost to the standing budget.');
        $this->assertEquals(50000, $april, 'The override leaked into a month it was never set for.');

        // 60,000 is over the standing 50,000 and under March's 90,000. Silence
        // here is the assertion: the warning has to read the same ceiling the
        // model does.
        $warnings = $this->postExpense([
            'expense_category_id' => $rent, 'description' => 'March rent', 'amount' => 60000,
        ])->assertCreated()->json('meta.warnings');
        $this->assertEmpty($warnings ?? [], 'A within-budget month was flagged as over.');

        $row = $this->budgetRow('Rent');
        $this->assertEquals(90000, $row['budget']);
        $this->assertEquals(50000, $row['standing'], 'The page cannot say which of the two rows to edit.');
        $this->assertTrue($row['is_override']);
        $this->assertEquals(60000, $row['spent']);
        $this->assertEquals(30000, $row['remaining']);
        $this->assertFalse($row['over']);

        // And going past the override does speak up — a ceiling that never
        // warns is the same as no ceiling.
        $over = $this->postExpense([
            'expense_category_id' => $rent, 'description' => 'Service charges', 'amount' => 35000,
        ])->assertCreated()->json('meta.warnings');
        $this->assertStringContainsString('over its', implode(' ', $over ?? []));
    }

    public function test_a_budget_still_reports_against_a_category_the_shop_has_closed(): void
    {
        // The other half of retirement. A category switched off mid-month keeps
        // both its ceiling and its spend, because the month it belongs to is not
        // over yet — dropping the ceiling would show 12,000 spent against no
        // budget at all and quietly turn an overspend into a shrug.
        $promo = $this->category('Ramzan Promo');
        $this->setBudget($promo, 10000);
        $this->expense(['expense_category_id' => $promo, 'description' => 'Banners', 'amount' => 12000]);

        ExpenseCategory::withoutTenancy()->whereKey($promo)->update(['is_active' => false]);

        $row = $this->budgetRow('Ramzan Promo');

        $this->assertTrue($row['is_retired']);
        $this->assertEquals(10000, $row['budget'], 'A closed category lost the ceiling it overspent.');
        $this->assertEquals(12000, $row['spent']);
        $this->assertEquals(-2000, $row['remaining']);
        $this->assertTrue($row['over']);
    }

    // ── branch → two screens ────────────────────────────────────────

    public function test_the_cashbook_and_the_ledger_are_one_book_when_a_branch_is_selected(): void
    {
        // The Cashbook says what each day came to; the Ledger says what the day
        // was MADE of. They are the same book at two zoom levels, and they read
        // two different code paths to get there — so an owner focused on one
        // branch was shown two answers to one question with no way to tell which
        // was the shop's.
        $rent = $this->category('Rent');
        $fees = $this->as($this->owner)->postJson('/api/v1/income-categories', ['name' => 'Fees'])
            ->assertCreated()->json('data.id');

        $gulberg = $this->as($this->owner)->postJson('/api/v1/branches', ['name' => 'Gulberg'])
            ->assertCreated()->json('data.id');

        // Last month, on Main only. Money before the window is never drawn as a
        // row, so an unscoped opening balance cannot be seen and spotted — it
        // just shifts every balance on the page.
        $this->expense(['expense_category_id' => $rent, 'description' => 'February rent',
            'amount' => 5000, 'expense_date' => '2026-02-10']);

        $this->expense(['expense_category_id' => $rent, 'description' => 'March rent — Main', 'amount' => 700]);
        $this->income(['income_category_id' => $fees, 'description' => 'Main fees', 'amount' => 1200]);

        $this->expense(['expense_category_id' => $rent, 'description' => 'March rent — Gulberg',
            'amount' => 250], branchId: $gulberg);
        $this->income(['income_category_id' => $fees, 'description' => 'Gulberg fees',
            'amount' => 4000], branchId: $gulberg);

        $range = ['period' => 'custom', 'from' => '2026-03-01', 'to' => '2026-03-31'];

        $cashbook = $this->cashbook($range, branchId: $gulberg);
        $ledger = $this->ledger($range, branchId: $gulberg);

        $this->assertEquals(250, $cashbook['totals']['expenses'], "Gulberg's own spending is missing from its cashbook.");
        $this->assertEquals(4000, $cashbook['totals']['other_income'], "Gulberg's own takings are missing from its cashbook.");
        $this->assertEquals(3750, $cashbook['totals']['net']);
        $this->assertEquals(250, $ledger['meta']['totals']['out'], 'The two screens disagree about what left Gulberg.');
        $this->assertEquals(4000, $ledger['meta']['totals']['in'], 'The two screens disagree about what came in.');
        $this->assertEquals(3750, $ledger['meta']['totals']['net']);

        // Main's February money is not Gulberg's opening balance.
        $this->assertEquals(0, $cashbook['opening_balance']);
        $this->assertEquals(0, $ledger['meta']['opening']);

        // Scoping narrows a focused view; it never hides money from the owner's
        // roll-up, and the roll-up has to agree with itself too.
        $allCashbook = $this->cashbook($range);
        $allLedger = $this->ledger($range);

        $this->assertEquals(950, $allCashbook['totals']['expenses']);
        $this->assertEquals(5200, $allCashbook['totals']['other_income']);
        $this->assertEquals(950, $allLedger['meta']['totals']['out']);
        $this->assertEquals(5200, $allLedger['meta']['totals']['in']);
        $this->assertEquals(-5000, $allCashbook['opening_balance']);
        $this->assertEquals(-5000, $allLedger['meta']['opening'], 'The two screens opened at different balances.');
    }

    public function test_a_ceiling_set_on_one_branch_is_charged_against_the_whole_company(): void
    {
        // BUG, pinned as CURRENT behaviour so the suite stays green.
        //
        // A budget is stored against whichever branch the owner had focused
        // when they set it. The owner's all-branches view passes no branch to
        // ExpenseBudget::inForce(), and inForce only filters by branch when it
        // is GIVEN one — so a Gulberg-only ceiling is picked up as if it were
        // the shop's standing budget and compared against every branch's spend.
        //
        // What the shopkeeper gets: an HQ page that says Rent is 30,000 over
        // budget when the branch that has a budget spent nothing at all. Worse,
        // the row reports `standing` and `is_override: false`, so the edit box
        // drawn off it rewrites one branch's ceiling while the owner believes
        // they are setting the company's.
        //
        // What it SHOULD do: an all-branches view either reads only the
        // shop-wide (branch_id null) rows, or rolls the per-branch ceilings up.
        // One branch's 50,000 must never be the ceiling for 80,000 spent
        // somewhere else.
        $rent = $this->category('Rent');
        $gulberg = $this->as($this->owner)->postJson('/api/v1/branches', ['name' => 'Gulberg'])
            ->assertCreated()->json('data.id');

        $this->as($this->owner)->withHeaders(['X-Branch-Id' => $gulberg])
            ->postJson('/api/v1/expenses/budgets', [
                'expense_category_id' => $rent, 'amount' => 50000,
            ])->assertOk();

        $this->assertSame($gulberg, ExpenseBudget::withoutTenancy()->firstOrFail()->branch_id);

        // Spent on Main. Gulberg, the only branch with a ceiling, spent nothing.
        $this->expense(['expense_category_id' => $rent, 'description' => 'Main rent', 'amount' => 80000]);

        // Fixed 2026-08-10. The HQ view now reports NO ceiling for Rent, because
        // the company never set one — only Gulberg did, for itself. It used to
        // borrow Gulberg's 50,000 and announce the company 30,000 over budget on
        // spending that happened at a branch with no budget at all.
        $hq = $this->budgetRow('Rent');
        $this->assertNull($hq['budget'], "One branch's ceiling is still being shown as the company's.");
        $this->assertEquals(80000, $hq['spent'], 'The HQ view is summing every branch, which is correct.');
        // Unbudgeted is not the same as a budget of zero: nothing can be over a
        // limit that was never set.
        $this->assertNull($hq['remaining']);
        $this->assertFalse($hq['over']);

        // The focused view is right, which is why this never showed up: the
        // branch that owns the budget reports its own (zero) spend against it.
        $focused = collect($this->as($this->owner)->withHeaders(['X-Branch-Id' => $gulberg])
            ->getJson('/api/v1/expenses/budgets')->assertOk()->json('data'))->firstWhere('category', 'Rent');

        $this->assertEquals(50000, $focused['budget']);
        $this->assertEquals(0, $focused['spent']);
        $this->assertFalse($focused['over']);
    }

    // ── book → CSV ──────────────────────────────────────────────────

    public function test_what_the_accountant_receives_is_what_was_on_the_screen(): void
    {
        // The export must reuse the query the merchant was looking at, not
        // approximate it — otherwise they get asked about rows they never saw,
        // and the month they signed off does not add up to the file they sent.
        $rent = $this->category('Rent');
        $fuel = $this->category('Fuel');
        $fees = $this->as($this->owner)->postJson('/api/v1/income-categories', ['name' => 'Fees'])
            ->assertCreated()->json('data.id');

        $this->expense(['expense_category_id' => $rent, 'description' => 'March rent', 'amount' => 85000]);
        $this->expense(['expense_category_id' => $fuel, 'description' => 'Diesel for the generator', 'amount' => 6000]);
        $this->income(['income_category_id' => $fees, 'description' => 'Retainer — March', 'amount' => 300000]);

        $expenses = $this->csv("/api/v1/expenses/export?category_id={$rent}");
        $this->assertStringContainsString('March rent', $expenses, 'A row on screen never reached the file.');
        $this->assertStringContainsString('85000', $expenses, 'The file carries the row without its figure.');
        $this->assertStringNotContainsString('Diesel for the generator', $expenses, 'The export widened the filter.');

        $income = $this->csv('/api/v1/incomes/export');
        $this->assertStringContainsString('Retainer — March', $income, 'Income cannot be handed to an accountant.');
        $this->assertStringContainsString('300000', $income);

        // The ledger export is the whole filtered book, not page one of it.
        $ledger = $this->csv('/api/v1/ledger/export?period=custom&from=2026-03-01&to=2026-03-31');
        foreach (['March rent', 'Diesel for the generator', 'Retainer — March'] as $line) {
            $this->assertStringContainsString($line, $ledger);
        }

        // GAP: budgets have no export. The one screen that answers "what did we
        // plan to spend against what we did" cannot leave the app, so the
        // budget-versus-actual conversation happens off a screenshot. Pinned as
        // a 404 so the day it ships, this line says so.
        $this->as($this->owner)->getJson('/api/v1/expenses/budgets/export')->assertNotFound();
    }

    // ── Helpers ─────────────────────────────────────────────────────

    /** @return array{0: Tenant, 1: User} */
    private function booksOnlyShop(): array
    {
        $city = City::query()->firstOrCreate(['name' => 'Lahore'], ['is_active' => true]);

        $shop = Tenant::factory()->create([
            'setup_completed' => true,
            'city_id' => $city->id,
            'business_type' => 'finance',
            'features' => BusinessTypes::defaultFeatures('finance'),
            'timezone' => 'UTC',
        ]);

        return [$shop, User::factory()->shopOwner($shop)->create()];
    }

    private function as(User $user): static
    {
        $this->defaultHeaders = [];
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function branch(string $name): Branch
    {
        return Branch::withoutTenancy()
            ->where('tenant_id', $this->shop->id)
            ->where('name', $name)
            ->firstOrFail();
    }

    private function category(string $name): string
    {
        return $this->as($this->owner)
            ->postJson('/api/v1/expense-categories', ['name' => $name])
            ->assertCreated()->json('data.id');
    }

    /** @param array<string, mixed> $overrides */
    private function postExpense(array $overrides = [], ?string $branchId = null): TestResponse
    {
        $request = $this->as($this->owner);

        if ($branchId !== null) {
            $request = $request->withHeaders(['X-Branch-Id' => $branchId]);
        }

        return $request->postJson('/api/v1/expenses', [
            'description' => 'Bill',
            'expense_date' => now()->toDateString(),
            'payment_method' => 'bank_transfer',
            ...$overrides,
        ]);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function expense(array $overrides = [], ?string $branchId = null): array
    {
        return $this->postExpense($overrides, $branchId)->assertCreated()->json('data');
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function income(array $overrides = [], ?string $branchId = null): array
    {
        $request = $this->as($this->owner);

        if ($branchId !== null) {
            $request = $request->withHeaders(['X-Branch-Id' => $branchId]);
        }

        return $request->postJson('/api/v1/incomes', [
            'description' => 'Received',
            'income_date' => now()->toDateString(),
            'payment_method' => 'bank_transfer',
            ...$overrides,
        ])->assertCreated()->json('data');
    }

    private function setBudget(string $categoryId, float $amount, ?string $month = null): void
    {
        $this->as($this->owner)->postJson('/api/v1/expenses/budgets', array_filter([
            'expense_category_id' => $categoryId,
            'amount' => $amount,
            'month' => $month,
        ], fn ($v) => $v !== null))->assertOk();
    }

    /**
     * @param  array<string, mixed>  $params
     * @return array<string, mixed>
     */
    private function expenses(array $params): array
    {
        return $this->as($this->owner)
            ->getJson('/api/v1/expenses?'.http_build_query($params))
            ->assertOk()->json();
    }

    /**
     * @param  array<string, mixed>  $params
     * @return array<string, mixed>
     */
    private function cashbook(array $params = ['period' => 'monthly'], ?string $branchId = null): array
    {
        $request = $this->as($this->owner);

        if ($branchId !== null) {
            $request = $request->withHeaders(['X-Branch-Id' => $branchId]);
        }

        return $request->getJson('/api/v1/cashbook?'.http_build_query($params))->assertOk()->json('data');
    }

    /**
     * @param  array<string, mixed>  $params
     * @return array<string, mixed>
     */
    private function ledger(array $params = ['period' => 'monthly'], ?string $branchId = null): array
    {
        $request = $this->as($this->owner);

        if ($branchId !== null) {
            $request = $request->withHeaders(['X-Branch-Id' => $branchId]);
        }

        return $request->getJson('/api/v1/ledger?'.http_build_query($params))->assertOk()->json();
    }

    /** @return array<int, array<string, mixed>> */
    private function ledgerRows(): array
    {
        return $this->ledger()['data'];
    }

    /** @return array<string, mixed> */
    private function budgetRow(string $category): array
    {
        $row = collect($this->as($this->owner)->getJson('/api/v1/expenses/budgets')->assertOk()->json('data'))
            ->firstWhere('category', $category);

        $this->assertNotNull($row, "The budgets page has no row for {$category}.");

        return $row;
    }

    private function csv(string $url): string
    {
        return $this->as($this->owner)->get($url)->assertOk()->streamedContent();
    }
}
