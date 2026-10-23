<?php

namespace Tests\Feature;

use App\Http\Middleware\AnswerOnce;
use App\Models\CashMovement;
use App\Models\City;
use App\Models\Customer;
use App\Models\CustomerLedgerEntry;
use App\Models\Income;
use App\Models\InstallmentPlan;
use App\Models\Product;
use App\Models\Register;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * GOODS GO HOME ON INSTALLMENTS (F1).
 *
 * The owner, 2026-10-15: "bht sary person ko installment py cheezein dy skta —
 * kitne months ki installment, duration, monthly kis din dy ga … or in
 * calculations sahi chal rhi ye b dekhna". Answered "market standard": the
 * goods go out on the day, an advance now, the rest month by month on the
 * customer's khata, an optional markup, not held to the khata limit.
 */
class GoodsGoHomeOnInstallmentsTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $fridge;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'retail', 'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->fridge = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Fridge', 'sku' => 'FRIDGE', 'price' => 60000, 'cost' => 45000,
            'stock_quantity' => 5, 'track_inventory' => true,
        ]);
    }

    private function asOwner(): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($this->owner->createToken('t', ['access'])->plainTextToken);
    }

    /** Ali takes a 60,000 fridge home: 10% markup, 16,000 down by card, 10 months. */
    private function start(array $over = []): array
    {
        return $this->asOwner()->postJson('/api/v1/installment-plans', array_replace([
            'customer_name' => 'Ali Raza', 'customer_phone' => '03000124123',
            'items' => [['product_id' => $this->fridge->id, 'quantity' => 1]],
            'markup_percent' => 10,
            'advance' => ['amount' => 16000, 'method' => 'card'],
            'months' => 10,
            'first_due_on' => now()->addMonth()->toDateString(),
        ], $over))->assertCreated()->json('data');
    }

    private function ali(): Customer
    {
        return Customer::withoutTenancy()->where('phone', '03000124123')->firstOrFail();
    }

    public function test_the_goods_go_home_today_and_the_rest_is_on_the_khata_month_by_month(): void
    {
        $plan = $this->start();

        // The terms, worked out by the server.
        $this->assertEquals(60000, $plan['cash_price']);
        $this->assertEquals(6000, $plan['markup']);
        $this->assertEquals(66000, $plan['total']);
        $this->assertEquals(50000, $plan['financed']);
        $this->assertEquals(5000, $plan['monthly']);
        $this->assertEquals(5000, $plan['last_month']);
        $this->assertSame('INS-000001', $plan['number']);
        $this->assertCount(10, $plan['standing']['rows']);
        $this->assertEquals(50000, $plan['standing']['left']);

        // One sale at the CASH price, today, the fridge off the shelf.
        $sale = Sale::withoutTenancy()->findOrFail($plan['sale_id']);
        $this->assertEquals(60000, (float) $sale->total);
        $this->assertEquals(4, (float) $this->fridge->fresh()->stock_quantity);

        // The khata holds the rest of the price AND the installment charge.
        $this->assertEquals(50000, (float) $this->ali()->credit_balance);

        // The markup is the shop's income for the day; the sale stays the cash price.
        $income = Income::withoutTenancy()->where('reference', 'INS-000001')->firstOrFail();
        $this->assertEquals(6000, (float) $income->amount);
        $today = now()->toDateString();
        $report = $this->asOwner()->getJson("/api/v1/reports/summary?period=custom&from={$today}&to={$today}")->json('data.totals');
        $this->assertEquals(60000, $report['revenue']);
        $this->assertEquals(6000, $report['other_income']);

        // The khata statement names the plan on the goods and on the charge.
        $ledger = $this->asOwner()->getJson("/api/v1/customers/{$this->ali()->id}")->assertOk()->json('data.ledger');
        $this->assertEqualsCanonicalizing(['INS-000001', 'INS-000001'], array_column($ledger, 'plan'));
        $this->assertEqualsCanonicalizing([44000, 6000], array_map('floatval', array_column($ledger, 'amount')));
    }

    /**
     * Found by the suite itself at 01:35 on 24 Oct: the markup was filed under
     * the WALL date while the sale went on the business day, which turns at
     * 05:00 — so a plan started after midnight put the fridge on one day's
     * books and its markup on the next, and neither day added up.
     */
    public function test_a_plan_started_after_midnight_files_its_markup_on_the_sales_day(): void
    {
        $this->travelTo(Carbon::parse('2026-10-24 01:30:00', 'Asia/Karachi'));
        $this->start();

        $income = Income::withoutTenancy()->where('reference', 'INS-000001')->firstOrFail();
        $this->assertSame('2026-10-23', $income->income_date->toDateString());
        $report = $this->asOwner()->getJson('/api/v1/reports/summary?period=custom&from=2026-10-23&to=2026-10-23')->json('data.totals');
        $this->assertEquals(60000, $report['revenue']);
        $this->assertEquals(6000, $report['other_income']);
    }

    /**
     * The sheet reads out the plan that is written.
     *
     * Money pass 2026-10-16 ($8): the sheet worked the plan out from shelf
     * prices BEFORE tax and said "500 now + 2 × 1,190 + 1,188.50 = 4,068.50";
     * the plan was written tax-inclusive at 4,760.25 and 1,421 a month, and
     * nothing on screen said so. It now asks the server what the plan will
     * be, and the server refuses to write it at a bill nobody was told.
     */
    public function test_a_running_plan_follows_the_customers_new_phone(): void
    {
        // Retail #15: the plan is found by the customer's phone, and it kept
        // the old one after the customer's was changed — finding nobody.
        $plan = $this->start();

        $this->asOwner()->putJson('/api/v1/customers/'.$this->ali()->id, ['name' => 'Ali Raza', 'phone' => '03000124999'])->assertOk();

        $this->assertSame('03000124999', InstallmentPlan::withoutTenancy()->findOrFail($plan['id'])->customer_phone);
    }

    public function test_the_sheet_is_told_the_plan_that_will_be_written(): void
    {
        $this->shop->forceFill(['settings' => array_merge($this->shop->settings ?? [], ['default_tax_rate' => 17])])->save();
        $terms = [
            'items' => [['product_id' => $this->fridge->id, 'quantity' => 1]],
            'markup_percent' => 10, 'advance' => ['amount' => 16000, 'method' => 'card'], 'months' => 3,
        ];

        // Before the phone is typed, and after.
        foreach ([[], ['customer_phone' => '03000124123']] as $who) {
            $asked = $this->asOwner()->postJson('/api/v1/installment-plans/worth', $terms + $who)->assertOk()->json('data');

            // 60,000 + 17 % = 70,200 cash; 10 % = 7,020; bill 77,220; 61,220
            // on the khata over 3 months: 20,407 + 20,407 + 20,406.
            $this->assertEquals(70200, $asked['cash_price'], 'the cash price is the bill with its tax, not the shelf price');
            $this->assertEquals(7020, $asked['markup']);
            $this->assertEquals(77220, $asked['total']);
            $this->assertEquals(61220, $asked['financed']);
            $this->assertEquals(20407, $asked['monthly']);
            $this->assertEquals(20406, $asked['last_month']);
        }

        // Asking wrote nothing: no sale, no plan, nobody filed, the fridge on the shelf.
        $this->assertSame(0, Sale::withoutTenancy()->count());
        $this->assertSame(0, InstallmentPlan::withoutTenancy()->count());
        $this->assertSame(0, Customer::withoutTenancy()->count());
        $this->assertEquals(5, $this->fridge->fresh()->stock_quantity);

        // A bill the plan would not be written at is refused, and writes nothing.
        $this->asOwner()->postJson('/api/v1/installment-plans', $terms + [
            'customer_phone' => '03000124123', 'first_due_on' => now()->addMonth()->toDateString(),
            'expected_total' => 66000,
        ])->assertStatus(409)->assertJsonPath('meta.error_code', 'PLAN_PRICE_CHANGED');
        $this->assertSame(0, Sale::withoutTenancy()->count());

        // The bill it was told is the bill it writes.
        $plan = $this->start(['months' => 3, 'expected_total' => $asked['total']]);
        $this->assertEquals($asked['total'], $plan['total']);
        $this->assertEquals($asked['monthly'], $plan['monthly']);
    }

    public function test_a_plan_is_not_held_to_the_everyday_khata_limit(): void
    {
        Customer::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Ali Raza', 'phone' => '03000124123', 'credit_limit' => 10000,
        ]);

        // On plain khata the fridge is refused…
        $this->asOwner()->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'credit', 'amount_paid' => 60000, 'customer_phone' => '03000124123',
            'items' => [['product_id' => $this->fridge->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'CREDIT_LIMIT_EXCEEDED');

        // …on a plan it goes home.
        $this->start();
        $this->assertEquals(50000, (float) $this->ali()->credit_balance);
    }

    public function test_installments_fill_the_oldest_month_and_the_plan_says_when_it_is_late(): void
    {
        $plan = $this->start(['first_due_on' => now()->addDays(10)->toDateString()]);

        // Forty days on: the first two months have passed unpaid.
        $this->travel(45)->days();
        $late = $this->asOwner()->getJson('/api/v1/installment-plans?status=late')->assertOk()->json('data');
        $this->assertSame([$plan['id']], array_column($late, 'id'));
        $this->assertEquals(10000, $late[0]['standing']['late']);
        $this->assertSame(2, $late[0]['standing']['late_months']);

        $paid = $this->asOwner()->postJson("/api/v1/installment-plans/{$plan['id']}/payments", ['amount' => 7000, 'method' => 'bank_transfer'])
            ->assertCreated()->json('data.plan.standing');
        $this->assertEquals(3000, $paid['late']);
        $this->assertSame(1, $paid['late_months']);
        $this->assertSame(1, $paid['months_paid']);
        $this->assertEquals(43000, $paid['left']);
        $this->assertEquals(43000, (float) $this->ali()->credit_balance, 'the khata and the plan read the same payment');

        $this->asOwner()->getJson('/api/v1/installment-plans/summary')->assertOk()
            ->assertJsonPath('data.counts.late', 1)
            ->assertJsonPath('data.out', 43000)
            ->assertJsonPath('data.late.total', 3000);
        $this->assertSame(['Ali Raza'], array_column($this->asOwner()->getJson('/api/v1/customers?standing=late_installments')->json('data'), 'name'));
    }

    public function test_more_than_is_left_is_refused_and_the_last_rupee_ends_the_plan(): void
    {
        $plan = $this->start();

        $this->asOwner()->postJson("/api/v1/installment-plans/{$plan['id']}/payments", ['amount' => 50001, 'method' => 'card'])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'INSTALLMENT_EXCEEDS_LEFT');

        $this->asOwner()->postJson("/api/v1/installment-plans/{$plan['id']}/payments", ['amount' => 50000, 'method' => 'card'])
            ->assertCreated()->assertJsonPath('data.plan.status', 'paid_off');
        $this->assertEquals(0, (float) $this->ali()->credit_balance);

        $this->asOwner()->postJson("/api/v1/installment-plans/{$plan['id']}/payments", ['amount' => 100, 'method' => 'card'])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'PLAN_NOT_RUNNING');
        $this->assertSame([$plan['id']], array_column($this->asOwner()->getJson('/api/v1/installment-plans?status=paid_off')->json('data'), 'id'));
    }

    public function test_a_cancelled_sale_closes_the_plan_and_takes_its_charge_out_of_income(): void
    {
        $plan = $this->start();

        $this->asOwner()->postJson("/api/v1/sales/{$plan['sale_id']}/cancel", ['reason_code' => 'wrong_item'])->assertOk();

        $this->assertSame(InstallmentPlan::STATUS_CLOSED, InstallmentPlan::withoutTenancy()->find($plan['id'])->status);
        $this->assertEquals(0, (float) $this->ali()->credit_balance);
        $this->assertNull(Income::withoutTenancy()->where('reference', 'INS-000001')->first(), 'a voided plan\'s charge was still counted as income');
    }

    public function test_an_advance_that_covers_the_price_is_a_sale_not_a_plan(): void
    {
        $this->asOwner()->postJson('/api/v1/installment-plans', [
            'customer_phone' => '03000124123', 'items' => [['product_id' => $this->fridge->id, 'quantity' => 1]],
            'advance' => ['amount' => 60000, 'method' => 'card'], 'months' => 3, 'first_due_on' => now()->addMonth()->toDateString(),
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'NOTHING_TO_FINANCE');

        $this->assertSame(0, Sale::withoutTenancy()->count(), 'a refused plan still rang a sale');
    }

    /**
     * CASH AGAINST KHATA NEEDS A DRAWER (L18).
     *
     * A cash payment on the khata — the card's or a plan's — was written to
     * the khata and reached no drawer when whoever took it had no shift open.
     * A shop that asks for shifts now refuses it, as it refuses a cash advance
     * (L2); a card payment is never held up.
     */
    public function test_cash_against_khata_needs_todays_shift_where_the_shop_asks_for_one(): void
    {
        $plan = $this->start();
        $this->asOwner()->putJson('/api/v1/shop/settings', ['pos_require_shift' => true])->assertOk();
        $ali = $this->ali();

        $this->asOwner()->postJson("/api/v1/installment-plans/{$plan['id']}/payments", ['amount' => 5000, 'method' => 'cash'])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'SHIFT_REQUIRED');
        $this->asOwner()->postJson("/api/v1/customers/{$ali->id}/payments", ['amount' => 5000, 'method' => 'cash'])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'SHIFT_REQUIRED');
        $this->assertEquals(50000, (float) $ali->fresh()->credit_balance, 'a refused cash payment still came off the khata');

        $this->asOwner()->postJson("/api/v1/installment-plans/{$plan['id']}/payments", ['amount' => 5000, 'method' => 'card'])->assertCreated();
        $this->assertEquals(45000, (float) $ali->fresh()->credit_balance);
    }

    /**
     * LATE AND THIS MONTH NEVER COUNT A RUPEE TWICE — and each tile opens the
     * plans behind its own figure.
     *
     * 10 April. Ali's plan fell due on 20 March (late) and falls due again on
     * the 20th (this month). Bilal's fell due on 5 March and 5 April (both
     * late) and next on 5 May — nothing more to come in April.
     */
    public function test_late_and_due_this_month_are_separate_sums_and_each_opens_its_own_plans(): void
    {
        $this->travelTo('2026-03-01 12:00:00');
        $ali = $this->start(['first_due_on' => '2026-03-20']);
        $bilal = $this->start([
            'customer_name' => 'Bilal', 'customer_phone' => '03000999888', 'markup_percent' => 0,
            'advance' => null, 'months' => 6, 'first_due_on' => '2026-03-05',
        ]);
        $this->assertEquals(10000, $bilal['monthly']);

        $this->travelTo('2026-04-10 12:00:00');
        $summary = $this->asOwner()->getJson('/api/v1/installment-plans/summary')->assertOk()->json('data');
        $this->assertEquals(110000, $summary['out']);
        $this->assertEquals(25000, $summary['late']['total'], 'Ali 5,000 + Bilal 2 × 10,000');
        $this->assertSame(2, $summary['late']['plans']);
        $this->assertEquals(5000, $summary['due_this_month'], 'only what falls due from today to the month\'s end — the late is counted once, as late');
        $this->assertSame(['running' => 2, 'due_soon' => 0, 'this_month' => 1, 'late' => 2, 'paid_off' => 0, 'closed' => 0, 'all' => 2], $summary['counts']);

        $list = fn (string $status) => array_column($this->asOwner()->getJson("/api/v1/installment-plans?status={$status}")->assertOk()->json('data'), 'id');
        $this->assertSame([$ali['id']], $list('this_month'));
        $this->assertSame([$bilal['id'], $ali['id']], $list('late'), 'whoever has waited longest comes first');

        // Ali pays up: March and April. Nothing is late or to come for him this month.
        $this->asOwner()->postJson("/api/v1/installment-plans/{$ali['id']}/payments", ['amount' => 10000, 'method' => 'card'])->assertCreated();
        $summary = $this->asOwner()->getJson('/api/v1/installment-plans/summary')->json('data');
        $this->assertEquals(0, $summary['due_this_month']);
        $this->assertEquals(20000, $summary['late']['total']);
        $this->assertEquals(10000, $summary['collected_this_month']);
        $this->assertSame([], $list('this_month'));
        $this->assertSame([$bilal['id']], $list('late'));
        $this->assertSame([$bilal['id'], $ali['id']], $list('running'), 'running lists the oldest unpaid month first');
    }

    /**
     * ONE FRIDGE OF TWO COMES BACK. What still owed comes off the khata and
     * off the plan alike; the plan says how much was PAID and how much came
     * off by the return — and the month's collections count only the money.
     */
    public function test_a_part_return_comes_off_what_is_left_and_is_not_counted_as_money_collected(): void
    {
        $plan = $this->start([
            'items' => [['product_id' => $this->fridge->id, 'quantity' => 2]],
            'markup_percent' => 0, 'advance' => ['amount' => 20000, 'method' => 'card'], 'months' => 10,
        ]);
        $this->assertEquals(100000, $plan['financed']);
        $this->asOwner()->postJson("/api/v1/installment-plans/{$plan['id']}/payments", ['amount' => 10000, 'method' => 'card'])->assertCreated();

        $sale = $this->asOwner()->getJson("/api/v1/sales/{$plan['sale_id']}")->assertOk()->json('data');
        $this->asOwner()->postJson("/api/v1/sales/{$plan['sale_id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]], 'reason' => 'Not cooling',
        ])->assertCreated();

        $shown = $this->asOwner()->getJson("/api/v1/installment-plans/{$plan['id']}")->assertOk()->json('data');
        $this->assertEquals(30000, $shown['standing']['left']);
        $this->assertEquals(30000, (float) $this->ali()->credit_balance, 'the khata and the plan disagree after a return');
        $this->assertEquals(10000, $shown['collected'], 'the goods coming back were counted as money paid');
        $this->assertEquals(60000, $shown['returned']);
        $this->assertSame(['card', 'return'], array_column($shown['payments'], 'method'));
        $this->assertSame('running', $shown['status']);
        $this->assertEquals(10000, $this->asOwner()->getJson('/api/v1/installment-plans/summary')->json('data.collected_this_month'));
    }

    /** The same press twice — a double tap, a retry on a slow line — is one plan, one sale, one charge. */
    public function test_one_press_starts_one_plan(): void
    {
        $first = $this->start(['idempotency_key' => 'press-1']);
        $again = $this->start(['idempotency_key' => 'press-1']);

        $this->assertSame($first['id'], $again['id']);
        $this->assertSame(1, InstallmentPlan::withoutTenancy()->count());
        $this->assertSame(1, Sale::withoutTenancy()->count());
        $this->assertSame(1, Income::withoutTenancy()->count());
        $this->assertEquals(50000, (float) $this->ali()->credit_balance);
        $this->assertEquals(4, (float) $this->fridge->fresh()->stock_quantity);

        $pay = fn () => $this->asOwner()->postJson("/api/v1/installment-plans/{$first['id']}/payments", ['amount' => 5000, 'method' => 'card', 'idempotency_key' => 'pay-1']);
        $pay()->assertCreated();
        $pay()->assertCreated();
        $this->assertSame(1, CustomerLedgerEntry::withoutTenancy()->where('type', 'payment')->count(), 'one installment was written twice');
        $this->assertEquals(45000, (float) $this->ali()->credit_balance);
    }

    /**
     * …and when the answer was not kept (the replay reached the server again),
     * the sale's own key brings back the same sale, and with it the same plan —
     * never a second plan, charge or income on one sale.
     */
    public function test_a_replay_past_the_kept_answer_still_starts_one_plan(): void
    {
        $this->withoutMiddleware(AnswerOnce::class);
        $first = $this->start(['idempotency_key' => 'press-2']);
        $again = $this->start(['idempotency_key' => 'press-2']);

        $this->assertSame($first['id'], $again['id']);
        $this->assertSame(1, InstallmentPlan::withoutTenancy()->count());
        $this->assertSame(1, Income::withoutTenancy()->count());
        $this->assertEquals(50000, (float) $this->ali()->credit_balance);
    }

    /**
     * An installment in cash goes into the taker's drawer and onto the day's
     * collections — and is never a second sale.
     */
    public function test_a_cash_installment_reaches_the_drawer_and_the_day_and_is_not_a_sale(): void
    {
        $plan = $this->start();
        $register = Register::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Lane 1', 'code' => 'L1', 'is_active' => true,
        ]);
        $this->asOwner()->postJson('/api/v1/pos/session/open', ['register_id' => $register->id, 'opening_float' => 1000])->assertCreated();

        $entry = $this->asOwner()->postJson("/api/v1/installment-plans/{$plan['id']}/payments", ['amount' => 5000, 'method' => 'cash'])
            ->assertCreated()->json('data.entry');

        $drawer = CashMovement::query()->where('source_id', $entry['id'])->sole();
        $this->assertSame('khata_in', $drawer->type);
        $this->assertEquals(5000, (float) $drawer->amount);

        $day = $this->asOwner()->getJson('/api/v1/pos/day')->assertOk()->json('data');
        $this->assertEquals(5000, $day['collections']['total']);
        $today = now()->toDateString();
        $report = $this->asOwner()->getJson("/api/v1/reports/summary?period=custom&from={$today}&to={$today}")->json('data');
        $this->assertEquals(60000, $report['totals']['revenue'], 'an installment was counted as a sale');
        $this->assertEquals(5000, $report['collections']['total']);
    }

    /** Another shop cannot read a plan, pay on it, or find it. */
    public function test_another_shop_cannot_see_or_pay_a_plan(): void
    {
        $plan = $this->start();
        $other = Tenant::factory()->create(['setup_completed' => true, 'business_type' => 'retail', 'features' => BusinessTypes::defaultFeatures('retail')]);
        $stranger = User::factory()->shopOwner($other)->create();
        $this->app['auth']->forgetGuards();
        $this->withToken($stranger->createToken('t', ['access'])->plainTextToken);

        $this->getJson("/api/v1/installment-plans/{$plan['id']}")->assertNotFound();
        $this->postJson("/api/v1/installment-plans/{$plan['id']}/payments", ['amount' => 100, 'method' => 'card'])->assertNotFound();
        $this->assertSame([], $this->getJson('/api/v1/installment-plans?status=all')->assertOk()->json('data'));
        $this->assertEquals(50000, (float) $this->ali()->credit_balance);
    }

    /** "Who has the fridge?" — a plan is found by what went home, and by its bill. */
    public function test_a_plan_is_found_by_the_goods_and_by_the_bill(): void
    {
        $plan = $this->start();
        $invoice = Sale::withoutTenancy()->findOrFail($plan['sale_id'])->invoice_number;

        foreach (['fridge', strtolower($invoice), 'INS-000001', '0300012'] as $term) {
            $this->assertSame([$plan['id']], array_column($this->asOwner()->getJson('/api/v1/installment-plans?status=all&search='.urlencode($term))->json('data'), 'id'), "not found by {$term}");
        }
        $this->assertSame([], $this->asOwner()->getJson('/api/v1/installment-plans?status=all&search=washing')->json('data'));
    }

    /**
     * The goods leave the counter on a sale: a shop that asks for shifts asks
     * for today's, however the advance is paid — and a refused plan writes
     * nothing: no sale, no khata, no plan, no income.
     */
    public function test_a_plan_needs_todays_shift_where_the_shop_asks_and_a_refusal_writes_nothing(): void
    {
        $this->asOwner()->putJson('/api/v1/shop/settings', ['pos_require_shift' => true])->assertOk();

        $this->asOwner()->postJson('/api/v1/installment-plans', [
            'customer_name' => 'Ali Raza', 'customer_phone' => '03000124123',
            'items' => [['product_id' => $this->fridge->id, 'quantity' => 1]],
            'markup_percent' => 10, 'advance' => ['amount' => 16000, 'method' => 'card'],
            'months' => 10, 'first_due_on' => now()->addMonth()->toDateString(),
        ])->assertStatus(409)->assertJsonPath('meta.error_code', 'SHIFT_REQUIRED');

        $this->assertSame(0, Sale::withoutTenancy()->count());
        $this->assertSame(0, InstallmentPlan::withoutTenancy()->count());
        $this->assertSame(0, Income::withoutTenancy()->count());
        $this->assertSame(0, CustomerLedgerEntry::withoutTenancy()->count());
        $this->assertEquals(5, (float) $this->fridge->fresh()->stock_quantity);
    }

    public function test_a_shop_can_say_it_does_not_sell_on_installments(): void
    {
        $this->asOwner()->putJson('/api/v1/shop/settings', ['installments_enabled' => false])->assertOk();

        $this->asOwner()->postJson('/api/v1/installment-plans', [
            'customer_phone' => '03000124123', 'items' => [['product_id' => $this->fridge->id, 'quantity' => 1]],
            'months' => 3, 'first_due_on' => now()->addMonth()->toDateString(),
        ])->assertStatus(403)->assertJsonPath('meta.error_code', 'INSTALLMENTS_DISABLED');
    }
}
