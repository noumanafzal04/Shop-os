<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\Product;
use App\Models\SubscriptionPayment;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Modules;
use App\Support\Permissions;
use App\Support\PlanLimits;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A PLAN IS MADE, A SHOP IS PUT ON IT, AND THREE MONTHS GO BY.
 *
 * Asked for in so many words: "create plans, create tenant, uska plan 2–3
 * month chalao, update karo, check karo process sahi chal raha — or pricing."
 *
 * Every rule of billing has a test of its own and all of them pass. None of
 * them lets a calendar turn. A subscription is the one part of this product
 * whose whole meaning is what happens LATER — the renewal that stacks, the
 * month that is paid late, the price that changes in between — and the seams
 * between those are where money goes missing without anything failing.
 *
 * So this walks one shop through its first quarter over real HTTP, the admin
 * on one side and the owner on the other, with the clock moved by hand, and
 * checks the three things somebody will actually be asked about:
 *
 *   WHAT IT OWES     the plan, plus what was switched on past it
 *   WHAT IT PAID     the ledger — only ever money somebody typed in
 *   WHAT IT MAY DO   paid, in grace, read-only, and back again
 *
 * What it found on the way is written up at each place it found it.
 */
class AShopPaysForThreeMonthsTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        // The ladder a shop can be moved up — Standard is where this one goes.
        $this->seed(PlanSeeder::class);
        $this->admin = User::factory()->superAdmin()->create();
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();

        return $this->withToken($token);
    }

    /** Ten in the morning, on that day. */
    private function itIs(string $date): void
    {
        $this->travelTo(Carbon::parse($date.' 10:00:00'));
    }

    /** A plan, made the way the Plans screen makes one. */
    private function aPlan(array $figures = []): array
    {
        return $this->as($this->admin)->postJson('/api/v1/admin/plans', $figures + [
            'name' => 'Corner Shop',
            'code' => 'corner-shop',
            'price' => 3000,
            'billing_period_months' => 1,
            'grace_period_days' => 5,
            'max_products' => 3,
            'max_staff' => 2,
            'max_branches' => 1,
            'max_registers' => 1,
            'max_orders_month' => 100,
            // A small shop's plan: a till, a shelf and the books. The customer
            // book is NOT in it — which is what makes it an add-on later.
            'modules' => ['products', 'pos', 'inventory', 'expenses'],
        ])->assertCreated()->json('data');
    }

    /**
     * Every module switch, as the forms send them: each one on or off. A
     * module left out of the list is NOT off — it stays whatever the trade
     * starts with — so the forms never leave one out, and neither does this.
     *
     * @return array<string, bool>
     */
    private function only(string ...$on): array
    {
        return array_merge(array_fill_keys(Modules::keys(), false), array_fill_keys($on, true));
    }

    /**
     * A shop, made the way the Create-a-business form makes one.
     *
     * @return array{0: Tenant, 1: User}
     */
    private function aShop(string $planId, array $over = []): array
    {
        $email = 'owner-'.uniqid().'@shop.test';

        $made = $this->as($this->admin)->postJson('/api/v1/admin/tenants', $over + [
            'business_name' => 'Madina General Store '.uniqid(),
            'business_type' => 'mart',
            'plan_id' => $planId,
            'modules' => $this->only('products', 'pos', 'inventory', 'expenses'),
            'owner' => ['name' => 'Aslam', 'email' => $email, 'password' => 'password123'],
        ])->assertCreated()->json('data');

        return [Tenant::query()->findOrFail($made['id']), User::query()->where('email', $email)->firstOrFail()];
    }

    /** The shop as the admin's own page reports it. */
    private function onTheAdminsPage(Tenant $shop): array
    {
        return $this->as($this->admin)->getJson("/api/v1/admin/tenants/{$shop->id}")->assertOk()->json('data');
    }

    /** The shop's subscription as its OWNER is shown it. */
    private function onTheOwnersPage(User $owner): array
    {
        return $this->as($owner)->getJson('/api/v1/shop/subscription')->assertOk()->json('data');
    }

    /** Record a payment and buy a period, the way the renewal dialog does. */
    private function pays(Tenant $shop, string $planId, ?float $amount, array $more = []): TestResponse
    {
        return $this->as($this->admin)->postJson("/api/v1/admin/tenants/{$shop->id}/assign-plan", $more + [
            'plan_id' => $planId,
        ] + ($amount === null ? [] : ['payment' => ['amount' => $amount, 'method' => 'cash']]));
    }

    /**
     * What the renewal dialog is told a payment taken now would buy:
     * [from, to, why]. Asked BEFORE each payment below, and the payment is
     * then held to it — the dialog and the save must never disagree.
     */
    private function wouldBuy(Tenant $shop, string $planId, string $more = ''): array
    {
        $told = $this->as($this->admin)
            ->getJson("/api/v1/admin/tenants/{$shop->id}/plan-window?plan_id={$planId}{$more}")
            ->assertOk()->json('data');

        return [$told['starts_on'], $told['ends_on'], $told['because']];
    }

    /** What the ledger holds for this shop, oldest first: [amount, period_start, period_end, paid on]. */
    private function ledger(Tenant $shop): array
    {
        return SubscriptionPayment::query()->where('tenant_id', $shop->id)->orderBy('paid_at')->get()
            ->map(fn (SubscriptionPayment $p): array => [
                (float) $p->amount, $p->period_start->toDateString(), $p->period_end->toDateString(), $p->paid_at->toDateString(),
            ])->all();
    }

    private function collectedBetween(string $from, string $to): float
    {
        return (float) $this->as($this->admin)->getJson("/api/v1/admin/billing/summary?from={$from}&to={$to}")
            ->assertOk()->json('data.in_period.collected.value');
    }

    private function sells(User $owner, string $productId): TestResponse
    {
        return $this->as($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 120,
            'items' => [['product_id' => $productId, 'quantity' => 1]],
        ]);
    }

    private function stocks(User $owner, string $name): TestResponse
    {
        return $this->as($owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => $name, 'price' => 120, 'cost' => 100,
            'track_inventory' => true, 'stock_quantity' => 500, 'description' => 'On the shelf', 'tax_rate' => 0,
        ]);
    }

    /**
     * ── FOUND: three boxes on the Plans screen that saved nothing ────────
     *
     * The plan form has a switch for selling offline, a box for how many days
     * a till may stay out of contact, and a box for how many bills a shop may
     * run past its month before anyone calls it over. It sent all three. The
     * server's rules listed none of them, so `validated()` dropped them and
     * answered "Plan updated"; and the plan it handed back did not carry them
     * either, so the card under the form read "Selling offline: No" for every
     * plan on the ladder — including the three that are seeded WITH it.
     *
     * Offline selling is the one capability a plan gates. It could be set by
     * the seeder and by nothing else.
     */
    public function test_a_plan_keeps_every_figure_typed_into_it(): void
    {
        $plan = $this->aPlan([
            'grace_orders_month' => 10,
            'max_offline_selling' => 1,
            'max_offline_days' => 2,
            'max_warehouses' => 0,
            'max_storage_mb' => 256,
            'retention_months' => 18,
        ]);

        // Read back off the list the screen draws, not off the reply to the save.
        $listed = collect($this->as($this->admin)->getJson('/api/v1/admin/plans')->assertOk()->json('data'))
            ->firstWhere('id', $plan['id']);

        $this->assertSame('3000.00', (string) $listed['price']);
        $this->assertSame(1, $listed['billing_period_months']);
        $this->assertSame(5, $listed['grace_period_days']);
        $this->assertSame(
            ['products' => 3, 'storage_mb' => 256, 'orders_month' => 100, 'branches' => 1, 'warehouses' => 0, 'staff' => 2, 'registers' => 1, 'retention_months' => 18],
            collect($listed['limits'])->only(['products', 'storage_mb', 'orders_month', 'branches', 'warehouses', 'staff', 'registers', 'retention_months'])->all(),
        );
        $this->assertSame(1, $listed['limits']['offline_selling'], 'Selling offline was switched on for this plan and the plan does not say so.');
        $this->assertSame(2, $listed['limits']['offline_days'], 'The days a till may stay out of contact were typed and not kept.');
        $this->assertSame(10, $listed['grace_orders_month'], 'The bills a shop may run over were typed and not kept.');
        $this->assertEqualsCanonicalizing(['products', 'pos', 'inventory', 'expenses'], $listed['modules']);

        // …and it is what a shop on the plan actually gets.
        [$shop] = $this->aShop($plan['id']);
        $this->assertSame(1, PlanLimits::limit($shop, 'offline_selling'), 'A shop on a plan that sells offline was not given it.');
        $this->assertSame(2, PlanLimits::limit($shop, 'offline_days'));

        // Switched off again, and the box emptied: both are answers, and both stick.
        $this->as($this->admin)->putJson("/api/v1/admin/plans/{$plan['id']}", [
            'max_offline_selling' => 0, 'max_offline_days' => null, 'grace_orders_month' => null,
        ])->assertOk();

        $again = collect($this->as($this->admin)->getJson('/api/v1/admin/plans')->json('data'))->firstWhere('id', $plan['id']);
        $this->assertSame(0, $again['limits']['offline_selling']);
        $this->assertNull($again['limits']['offline_days']);
        $this->assertNull($again['grace_orders_month']);
        $this->assertSame(0, PlanLimits::limit($shop->fresh(), 'offline_selling'), 'Offline selling was switched off on the plan and the shop still has it.');
    }

    /**
     * ── FOUND: a blank amount was booked as the plan's full price ────────
     *
     * Both forms say it in so many words. Create a business: "Opening payment
     * — leave the amount blank if nothing was taken yet." Renew: "leave amount
     * blank for a free/complimentary assignment." Both then send no payment
     * at all — and the server, given none, wrote one for the plan's price.
     *
     * So a shop signed up on a promise to pay next week was in the ledger as
     * Rs 2,499 collected, in cash nobody held, on the day it was created; and
     * a free month given to a shop finding its feet was revenue. "Collected
     * this month" was the sum of what was paid and what was not asked for.
     *
     * The ledger holds money somebody typed in. Nothing else.
     */
    public function test_a_shop_that_was_not_charged_has_paid_nothing(): void
    {
        $this->itIs('2026-07-01');
        $plan = $this->aPlan();

        // Made with the payment boxes left empty.
        [$shop] = $this->aShop($plan['id']);

        $this->assertSame([], $this->ledger($shop), 'A shop created with no opening payment is in the ledger as having paid.');
        $this->assertEquals(0, $this->collectedBetween('2026-07-01', '2026-07-31'), 'Money nobody took is counted as collected.');
        // It still has its month: the window is the plan's, the money is not assumed.
        $this->assertSame('2026-08-01', $shop->fresh()->subscription_ends_at->toDateString());

        // A month given free, the way the dialog says to give one.
        $this->itIs('2026-07-20');
        $this->pays($shop, $plan['id'], null)->assertOk();

        $this->assertSame('2026-09-01', $shop->fresh()->subscription_ends_at->toDateString());
        $this->assertSame([], $this->ledger($shop), 'A complimentary month was written into the ledger as a payment.');

        // Nought typed on purpose is the same answer.
        $this->pays($shop, $plan['id'], 0)->assertOk();
        $this->assertSame([], $this->ledger($shop));

        // And money that WAS typed is there, to the rupee.
        $this->pays($shop, $plan['id'], 3000)->assertOk();
        $this->assertSame([3000.0], array_column($this->ledger($shop), 0));
        $this->assertEquals(3000, $this->collectedBetween('2026-07-01', '2026-07-31'));
    }

    public function test_one_shop_through_its_first_three_months(): void
    {
        // ── 1 JULY · the plan, the price list, the shop ─────────────────
        $this->itIs('2026-07-01');

        $plan = $this->aPlan();
        $this->as($this->admin)->putJson('/api/v1/admin/modules/prices', [
            'changes' => ['customers' => 400, 'labels' => 150],
        ])->assertOk();

        [$shop, $owner] = $this->aShop($plan['id'], [
            'payment' => ['amount' => 3000, 'method' => 'cash', 'reference' => 'R-001'],
        ]);

        $page = $this->onTheAdminsPage($shop);
        $this->assertSame('paid', $page['payment_status']);
        $this->assertSame([], $page['package']['addons'], 'A shop with only what its plan includes was given an add-on.');
        $this->assertEquals(3000, $page['package']['bill']['total']);
        $this->assertSame([[3000.0, '2026-07-01', '2026-08-01', '2026-07-01']], $this->ledger($shop));

        $owners = $this->onTheOwnersPage($owner);
        $this->assertSame('active', $owners['state']);
        $this->assertSame('Corner Shop', $owners['plan']['name']);
        $this->assertEquals(3000, $owners['plan']['price']);
        $this->assertCount(1, $owners['payments']);
        $this->assertStringStartsWith('2026-08-01', $owners['subscription_ends_at']);

        // It trades. Three products is what the plan holds, and the fourth says so.
        $soap = $this->stocks($owner, 'Soap')->assertCreated()->json('data.id');
        $this->stocks($owner, 'Tea')->assertCreated();
        $this->stocks($owner, 'Sugar')->assertCreated();
        $this->stocks($owner, 'Rice')->assertStatus(422)->assertJsonPath('meta.error_code', 'LIMIT_REACHED');
        $this->sells($owner, $soap)->assertCreated();

        // ── 15 JULY · it asks for the customer book ─────────────────────
        $this->itIs('2026-07-15');

        $this->as($this->admin)->putJson("/api/v1/admin/tenants/{$shop->id}/modules", [
            'modules' => $this->only('products', 'pos', 'inventory', 'expenses', 'customers'),
        ])->assertOk();

        $bill = $this->onTheAdminsPage($shop)['package']['bill'];
        $this->assertSame(['customers'], array_column($bill['addons'], 'key'), 'A module switched on past the plan is not on the bill.');
        $this->assertEquals(400, $bill['addons_total']);
        $this->assertEquals(3400, $bill['total'], 'The bill is not the plan plus its add-on.');
        // Nothing is charged for the days already paid for: the ledger has not moved.
        $this->assertCount(1, $this->ledger($shop));
        // The door is open the moment it is switched on.
        $this->as($owner)->getJson('/api/v1/customers')->assertOk();

        // ── 28 JULY · the first renewal, paid early ─────────────────────
        $this->itIs('2026-07-28');

        $this->assertSame(['2026-08-01', '2026-09-01', 'running'], $this->wouldBuy($shop, $plan['id']));
        $this->pays($shop, $plan['id'], 3400)->assertOk();

        $shop->refresh();
        $this->assertSame('2026-09-01', $shop->subscription_ends_at->toDateString(), 'A renewal paid early did not start where the paid month ends.');
        $this->assertSame('2026-07-01', $shop->subscription_starts_at->toDateString(), 'A renewal moved the day the shop joined.');
        $this->assertSame([3400.0, '2026-08-01', '2026-09-01', '2026-07-28'], $this->ledger($shop)[1]);

        // ── 10 AUGUST · the plan is repriced ────────────────────────────
        $this->itIs('2026-08-10');

        $this->as($this->admin)->putJson("/api/v1/admin/plans/{$plan['id']}", ['price' => 3500])->assertOk();

        $this->assertEquals(3900, $this->onTheAdminsPage($shop)['package']['bill']['total'], 'The next bill does not carry the new price.');
        $this->assertEquals(3500, $this->onTheOwnersPage($owner)['plan']['price']);
        // What was already paid was paid at the old price, and stays that way.
        $this->assertSame([3000.0, 3400.0], array_column($this->ledger($shop), 0));
        $this->assertSame('2026-09-01', $shop->fresh()->subscription_ends_at->toDateString());

        // ── 20 AUGUST · this shop is given its own price for the add-on ──
        $this->itIs('2026-08-20');

        $this->as($this->admin)->putJson("/api/v1/admin/tenants/{$shop->id}/modules", [
            'modules' => $this->only('products', 'pos', 'inventory', 'expenses', 'customers'),
            'addon_prices' => ['customers' => 250],
        ])->assertOk();

        $bill = $this->onTheAdminsPage($shop)['package']['bill'];
        $this->assertEquals(250, $bill['addons'][0]['monthly']);
        $this->assertEquals(400, $bill['addons'][0]['listed'], 'The list price is not shown beside the price this shop was given.');
        $this->assertTrue($bill['addons'][0]['own_price']);
        $this->assertEquals(3750, $bill['total']);

        // ── FOUND: the shop was shown the plan's price as what it pays ───
        //
        // Its own Subscription screen said "Rs 3,500 every month" to a shop
        // that is asked for Rs 3,750: the add-on was on the admin's page and
        // nowhere the shop could see it. The owner is told the same bill.
        $owners = $this->onTheOwnersPage($owner)['bill'];
        $this->assertEquals(3500, $owners['plan']);
        $this->assertSame([['key' => 'customers', 'label' => 'Customers & Khata', 'monthly' => 250, 'amount' => 250]], array_map(
            fn (array $a): array => ['key' => $a['key'], 'label' => $a['label'], 'monthly' => (int) $a['monthly'], 'amount' => (int) $a['amount']],
            $owners['addons'],
        ));
        $this->assertEquals(3750, $owners['total'], 'The shop is not told what it is actually asked to pay.');
        // What it was given at another shop's price is not its business: no list price.
        $this->assertArrayNotHasKey('listed', $owners['addons'][0]);

        // ── 3 SEPTEMBER · the month ran out two days ago ────────────────
        $this->itIs('2026-09-03');

        $page = $this->onTheAdminsPage($shop);
        $this->assertSame('grace', $page['subscription_state']);
        $this->assertSame('grace', $page['payment_status']);
        $owners = $this->onTheOwnersPage($owner);
        $this->assertSame('grace', $owners['state']);
        $this->assertStringStartsWith('2026-09-06', $owners['grace_ends_at'], 'Grace is not the five days this plan gives.');
        // In grace the shop works exactly as it did.
        $this->sells($owner, $soap)->assertCreated();

        // ── FOUND: paying late moved the month, and gave the late days away ──
        //
        // A renewal "after expiry" started its period on the day it was
        // typed. For a shop that is two days into grace that means September
        // ran 3rd to 3rd: the 1st and 2nd — days it traded on in full — were
        // never part of any paid period, and every month it paid late moved
        // its renewal date later for good. A shop that always paid on the
        // last day of a fourteen-day grace paid for eight months in twelve.
        //
        // Grace is full use of the product, so it is part of the month that
        // follows: a renewal during grace carries on from where the paid
        // month ended. (A period typed by hand still overrides it.)
        $this->assertSame(['2026-09-01', '2026-10-01', 'grace'], $this->wouldBuy($shop, $plan['id']), 'The dialog is not told that a payment in grace carries on from the end of the paid month.');
        $this->pays($shop, $plan['id'], 3750, ['payment' => ['amount' => 3750, 'method' => 'bank_transfer', 'reference' => 'TRX-0903']])->assertOk();

        $shop->refresh();
        $this->assertSame('2026-10-01', $shop->subscription_ends_at->toDateString(), 'A month paid two days late was moved two days later.');
        $this->assertSame('2026-07-01', $shop->subscription_starts_at->toDateString(), 'Paying late reset the day the shop joined.');
        $this->assertSame([3750.0, '2026-09-01', '2026-10-01', '2026-09-03'], $this->ledger($shop)[2]);
        $this->assertSame('paid', $this->onTheAdminsPage($shop)['payment_status']);

        // ── 7 OCTOBER · nobody paid, and grace is spent ─────────────────
        $this->itIs('2026-10-07');

        $page = $this->onTheAdminsPage($shop);
        $this->assertSame('read_only', $page['subscription_state']);
        $this->assertSame('unpaid', $page['payment_status']);
        $this->assertSame('read_only', $this->onTheOwnersPage($owner)['state']);

        // Nothing can be written — and it says why, not "Forbidden".
        $this->sells($owner, $soap)->assertForbidden()->assertJsonPath('meta.error_code', 'SUBSCRIPTION_EXPIRED');
        $this->stocks($owner, 'Flour')->assertForbidden()->assertJsonPath('meta.error_code', 'SUBSCRIPTION_EXPIRED');
        // Everything can still be read: the shop's books are the shop's.
        $this->as($owner)->getJson('/api/v1/products')->assertOk()->assertJsonCount(3, 'data');
        $this->as($owner)->getJson('/api/v1/sales')->assertOk();
        $this->assertSame(3, Product::withoutTenancy()->where('tenant_id', $shop->id)->count());

        // ── 9 OCTOBER · it pays, eight days after the month ended ───────
        $this->itIs('2026-10-09');

        $this->assertSame(['2026-10-09', '2026-11-09', 'lapsed'], $this->wouldBuy($shop, $plan['id']));
        // Dates typed by hand are what it would buy, whatever the rule says.
        $this->assertSame(
            ['2026-10-01', '2026-11-01', 'stated'],
            $this->wouldBuy($shop, $plan['id'], '&starts_at=2026-10-01&ends_at=2026-11-01'),
        );
        $this->pays($shop, $plan['id'], 3750)->assertOk();

        // Grace was spent and the shop was shut: those days were not use of
        // the product, so this month starts today.
        $shop->refresh();
        $this->assertSame('2026-11-09', $shop->subscription_ends_at->toDateString());
        $this->assertSame([3750.0, '2026-10-09', '2026-11-09', '2026-10-09'], $this->ledger($shop)[3]);
        $this->assertSame('active', $this->onTheOwnersPage($owner)['state']);
        // It comes straight back, with everything it had.
        $this->sells($owner, $soap)->assertCreated();

        // ── 20 OCTOBER · it has outgrown the plan ───────────────────────
        $this->itIs('2026-10-20');

        $standard = Plan::query()->where('code', 'premium')->firstOrFail();

        // Asked first, the way the dialog asks: what would moving do?
        $preview = collect($this->as($this->admin)
            ->getJson("/api/v1/admin/tenants/{$shop->id}/plan-change?plan_id={$standard->id}")
            ->assertOk()->json('data.rows'))->keyBy('key');
        $this->assertSame(3, $preview['products']['from']);
        $this->assertSame(10000, $preview['products']['to']);
        $this->assertSame(3, $preview['products']['used']);

        $this->assertSame(['2026-10-20', '2026-11-20', 'new_plan'], $this->wouldBuy($shop, $standard->id));
        $this->pays($shop, $standard->id, 4999)->assertOk();

        $shop->refresh();
        // A different plan is a new period from today. What was left of the
        // old one is NOT carried over — there is no pro-rating; the admin
        // types the amount agreed. Written down here because it is a rule
        // somebody will be asked about on the phone.
        $this->assertSame('2026-11-20', $shop->subscription_ends_at->toDateString());
        $this->assertSame([4999.0, '2026-10-20', '2026-11-20', '2026-10-20'], $this->ledger($shop)[4]);

        // The ceiling moved with the plan: the product refused in July goes in.
        $this->stocks($owner, 'Rice')->assertCreated();

        // Modules are the shop's, not the plan's: nothing was taken away by moving.
        $this->assertTrue($shop->featureEnabled('customers'));
        $this->assertTrue($shop->featureEnabled('inventory'));

        // ── THE QUARTER, ADDED UP ───────────────────────────────────────
        $this->assertSame([3000.0, 3400.0, 3750.0, 3750.0, 4999.0], array_column($this->ledger($shop), 0));

        // By the month the money ARRIVED — which is what "collected" means.
        $this->assertEquals(6400, $this->collectedBetween('2026-07-01', '2026-07-31'));
        $this->assertEquals(0, $this->collectedBetween('2026-08-01', '2026-08-31'));
        $this->assertEquals(3750, $this->collectedBetween('2026-09-01', '2026-09-30'));
        $this->assertEquals(8749, $this->collectedBetween('2026-10-01', '2026-10-31'));

        // The ledger screen, asked for this shop, agrees with all of it.
        $screen = $this->as($this->admin)->getJson("/api/v1/admin/billing/payments?tenant_id={$shop->id}")->assertOk();
        $this->assertSame(5, $screen->json('meta.totals.payments'));
        $this->assertEquals(18899, $screen->json('meta.totals.amount'));

        // And the owner is shown the same five payments, newest first.
        $this->assertSame(
            ['4999.00', '3750.00', '3750.00', '3400.00', '3000.00'],
            array_map(fn (array $p): string => (string) $p['amount'], $this->onTheOwnersPage($owner)['payments']),
        );
    }

    /**
     * An add-on is priced by the month and a plan may be paid by the year.
     */
    public function test_a_shop_that_pays_by_the_year_pays_twelve_months_of_its_add_ons(): void
    {
        $this->itIs('2026-07-01');

        $yearly = $this->aPlan(['name' => 'Corner Shop Yearly', 'code' => 'corner-shop-yearly', 'price' => 30000, 'billing_period_months' => 12]);
        $this->as($this->admin)->putJson('/api/v1/admin/modules/prices', ['changes' => ['customers' => 400]])->assertOk();

        [$shop] = $this->aShop($yearly['id'], [
            'modules' => $this->only('products', 'pos', 'inventory', 'expenses', 'customers'),
            'payment' => ['amount' => 34800, 'method' => 'bank_transfer'],
        ]);

        $bill = $this->onTheAdminsPage($shop)['package']['bill'];
        $this->assertSame(12, $bill['plan']['months']);
        $this->assertEquals(400, $bill['addons_monthly']);
        $this->assertEquals(4800, $bill['addons_total']);
        $this->assertEquals(34800, $bill['total']);

        // The owner's screen says the year's figure for the add-on, and the same total.
        $owner = User::query()->where('tenant_id', $shop->id)->firstOrFail();
        $owners = $this->onTheOwnersPage($owner)['bill'];
        $this->assertSame(12, $owners['months']);
        $this->assertEquals(400, $owners['addons'][0]['monthly']);
        $this->assertEquals(4800, $owners['addons'][0]['amount']);
        $this->assertEquals(34800, $owners['total']);
        $this->assertSame([[34800.0, '2026-07-01', '2027-07-01', '2026-07-01']], $this->ledger($shop));

        // Renewed in its last month: the year stacks like a month does.
        $this->itIs('2027-06-15');
        $this->pays($shop, $yearly['id'], 34800)->assertOk();
        $this->assertSame('2028-07-01', $shop->fresh()->subscription_ends_at->toDateString());
    }

    /**
     * Moving DOWN, onto a plan smaller than what the shop already holds.
     */
    public function test_a_shop_moved_to_a_smaller_plan_keeps_what_it_has_and_adds_no_more(): void
    {
        $this->itIs('2026-07-01');

        $small = $this->aPlan();
        $standard = Plan::query()->where('code', 'premium')->firstOrFail();
        [$shop, $owner] = $this->aShop($standard->id, ['payment' => ['amount' => 4999]]);

        foreach (['Soap', 'Tea', 'Sugar', 'Rice', 'Flour'] as $name) {
            $this->stocks($owner, $name)->assertCreated();
        }

        // Asked first: the dialog has to be able to say what will not fit.
        $row = collect($this->as($this->admin)
            ->getJson("/api/v1/admin/tenants/{$shop->id}/plan-change?plan_id={$small['id']}")
            ->assertOk()->json('data.rows'))->firstWhere('key', 'products');
        $this->assertSame(5, $row['used']);
        $this->assertSame(3, $row['to']);
        $this->assertSame(2, $row['excess'], 'Two products will not fit the smaller plan and the preview does not say so.');

        $this->pays($shop, $small['id'], 3000)->assertOk();

        // Nothing it had is taken away…
        $this->as($owner)->getJson('/api/v1/products')->assertOk()->assertJsonCount(5, 'data');
        // …and it sells them as before…
        $soap = Product::withoutTenancy()->where('tenant_id', $shop->id)->where('name', 'Soap')->value('id');
        $this->sells($owner, $soap)->assertCreated();
        // …but a sixth is refused, at the smaller plan's number.
        $this->stocks($owner, 'Salt')->assertStatus(422)->assertJsonPath('meta.error_code', 'LIMIT_REACHED');
    }

    /**
     * ── FOUND: a month added to the 31st ran into the month after ────────
     *
     * `addMonths` rolls a date that does not exist forward. A shop put on a
     * monthly plan on 31 January was paid up to 3 March; one on 31 August, to
     * 1 October. Days nobody was charged for, a renewal date that crept from
     * the last day of the month to the 3rd — and the bills meter, which
     * clamps, counted its month to the 28th. A month is added the way a bank
     * adds one.
     */
    public function test_a_month_bought_on_the_last_day_ends_on_the_last_day(): void
    {
        $plan = $this->aPlan();

        $this->itIs('2026-01-31');
        [$january] = $this->aShop($plan['id'], ['payment' => ['amount' => 3000]]);
        $this->assertSame('2026-02-28', $january->fresh()->subscription_ends_at->toDateString(), 'A month from 31 January ran into March.');
        $this->assertSame([[3000.0, '2026-01-31', '2026-02-28', '2026-01-31']], $this->ledger($january));

        // The bills meter agrees about where that month ends.
        $this->itIs('2026-02-28');
        $this->assertSame('2026-02-28', PlanLimits::periodStart($january->fresh())->toDateString());

        // Renewed on its last day: one more month, not one month and three days.
        $this->assertSame(['2026-02-28', '2026-03-28', 'running'], $this->wouldBuy($january, $plan['id']));
        $this->pays($january, $plan['id'], 3000)->assertOk();
        $this->assertSame('2026-03-28', $january->fresh()->subscription_ends_at->toDateString());

        $this->itIs('2026-08-31');
        [$august] = $this->aShop($plan['id'], ['payment' => ['amount' => 3000]]);
        $this->assertSame('2026-09-30', $august->fresh()->subscription_ends_at->toDateString(), 'A month from 31 August ran into October.');

        // A year bought on 29 February ends on the 28th, not on 1 March.
        $yearly = $this->aPlan(['name' => 'Corner Shop Yearly', 'code' => 'corner-shop-yearly', 'price' => 30000, 'billing_period_months' => 12]);
        $this->itIs('2028-02-29');
        [$leap] = $this->aShop($yearly['id'], ['payment' => ['amount' => 30000]]);
        $this->assertSame('2029-02-28', $leap->fresh()->subscription_ends_at->toDateString());
    }

    /** A shop that has never been on a plan before has nothing to carry on from. */
    public function test_the_dialog_is_told_the_dates_and_why_before_anything_is_saved(): void
    {
        $this->itIs('2026-07-01');
        $plan = $this->aPlan();
        $standard = Plan::query()->where('code', 'premium')->firstOrFail();

        $bare = Tenant::factory()->create(['plan_id' => null, 'subscription_starts_at' => null, 'subscription_ends_at' => null]);
        $this->assertSame(['2026-07-01', '2026-08-01', 'first'], $this->wouldBuy($bare, $plan['id']));

        // Asking writes nothing.
        $this->assertNull($bare->fresh()->plan_id);
        $this->assertSame(0, SubscriptionPayment::query()->count());

        // Dates typed the wrong way round are said to be wrong before the save refuses them.
        $told = $this->as($this->admin)
            ->getJson("/api/v1/admin/tenants/{$bare->id}/plan-window?plan_id={$plan['id']}&starts_at=2026-08-01&ends_at=2026-07-01")
            ->assertOk()->json('data');
        $this->assertFalse($told['valid']);
        $this->pays($bare, $plan['id'], 3000, ['period' => ['starts_at' => '2026-08-01', 'ends_at' => '2026-07-01']])->assertStatus(422);

        // A shop still running, asked about a different plan: a new period from today.
        [$shop] = $this->aShop($plan['id'], ['payment' => ['amount' => 3000]]);
        $this->itIs('2026-07-10');
        $this->assertSame(['2026-07-10', '2026-08-10', 'new_plan'], $this->wouldBuy($shop, $standard->id));
        $this->assertSame(['2026-08-01', '2026-09-01', 'running'], $this->wouldBuy($shop, $plan['id']));

        // Only somebody who may assign a plan is told: not a shop's owner, and
        // not platform staff who were given the tenant list and nothing more.
        $owner = User::factory()->shopOwner($shop)->create();
        $this->as($owner)->getJson("/api/v1/admin/tenants/{$shop->id}/plan-window?plan_id={$plan['id']}")->assertForbidden();

        $looksOnly = User::factory()->adminStaff([Permissions::TENANTS_VIEW])->create();
        $this->as($looksOnly)->getJson("/api/v1/admin/tenants/{$shop->id}/plan-window?plan_id={$plan['id']}")->assertForbidden();

        $renews = User::factory()->adminStaff([Permissions::TENANTS_VIEW, Permissions::TENANTS_ASSIGN_PLAN])->create();
        $this->as($renews)->getJson("/api/v1/admin/tenants/{$shop->id}/plan-window?plan_id={$plan['id']}")->assertOk();
    }
}
