<?php

namespace Tests\Feature;

use App\Actions\Sale\CreateSaleAction;
use App\Http\Requests\Pos\SyncRequest;
use App\Models\Branch;
use App\Models\BusinessDay;
use App\Models\CashSession;
use App\Models\Customer;
use App\Models\PosDevice;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Where sales rung with no server arrive.
 *
 * The endpoint's job is NOT to approve. The money already crossed the counter,
 * so nothing here can un-ring a sale — it records what happened and reports
 * what differs. Every test below is one consequence of that sentence, and the
 * two that matter most are opposites:
 *
 *   a sale must never be LOST      — not to stock, not to a closed shift, not
 *                                    to a policy the till broke
 *   a sale must never be DOUBLED   — a lost acknowledgement is one dropped
 *                                    packet, and it must not bank the money
 *                                    twice
 */
class PosSyncTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $cashier;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->cashier = User::factory()->tenantStaff($this->tenant, ['sales.manage'])->create();
        $this->product = Product::query()->create([
            'tenant_id' => $this->tenant->id,
            'type' => 'product',
            'item_type' => 'physical_product',
            'name' => 'Milkpak 1L',
            'price' => 100,
            'stock_quantity' => 50,
            'track_inventory' => true,
            'is_active' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** One offline sale, as the till queued it. */
    private function operation(array $over = [], array $sale = []): array
    {
        return array_merge([
            'op' => (string) Str::uuid(),
            'at' => now()->subDay()->toIso8601String(),
            'offline_number' => 'OFF-L1-AB-000001',
            'sale' => array_merge([
                'channel' => 'pos',
                'items' => [['product_id' => $this->product->id, 'quantity' => 2]],
                'payment_method' => 'cash',
                'amount_paid' => 500,
            ], $sale),
        ], $over);
    }

    private function sync(array $operations, ?string $deviceId = null): TestResponse
    {
        return $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/sync', [
            'operations' => $operations,
        ] + ($deviceId === null ? [] : ['device_id' => $deviceId]));
    }

    // ── The sale lands ──────────────────────────────────────────────

    public function test_an_offline_sale_lands_and_gets_a_real_invoice_number(): void
    {
        $result = $this->sync([$this->operation()])->assertOk()->json('data.results.0');

        $this->assertSame('applied', $result['status']);
        $this->assertNotNull($result['invoice_number']);

        $sale = Sale::withoutTenancy()->find($result['sale_id']);
        $this->assertEqualsWithDelta(200.0, (float) $sale->total, 0.001);
    }

    public function test_the_provisional_number_survives_the_real_one(): void
    {
        // The customer walked out with that slip in the bag. Dropping it would
        // mean the only reference they hold names a sale nobody can find.
        $result = $this->sync([$this->operation()])->assertOk()->json('data.results.0');

        $sale = Sale::withoutTenancy()->find($result['sale_id']);
        $this->assertSame('OFF-L1-AB-000001', $sale->offline_number);
        $this->assertNotNull($sale->invoice_number);
        $this->assertNotSame($sale->offline_number, $sale->invoice_number);
    }

    public function test_the_sale_is_filed_on_the_day_it_happened_not_the_day_it_arrived(): void
    {
        // The one that decides whose takings these are. A Tuesday sale synced
        // on Friday belongs to Tuesday's drawer, Tuesday's day and Tuesday's
        // cashier — filing it under Friday moves money between two people's
        // figures and both of them are then wrong.
        $tuesday = now()->subDays(3)->startOfHour();

        $result = $this->sync([$this->operation(['at' => $tuesday->toIso8601String()])])
            ->assertOk()->json('data.results.0');

        $sale = Sale::withoutTenancy()->find($result['sale_id']);
        $this->assertSame($tuesday->toDateString(), $sale->sold_at->toDateString());
        $this->assertNotNull($sale->synced_at);
        $this->assertSame(now()->toDateString(), $sale->synced_at->toDateString());
    }

    // ── The till never names a price ────────────────────────────────
    //
    // If a device could dictate what a line cost, offline would be a
    // price-override switch with a queue in front of it. TWO independent things
    // stop that, and they are tested apart because each on its own reads as
    // sufficient and neither is:
    //
    //   1. the request has no `unit_price` rule, so it never survives
    //      validation — and this is what actually fires today
    //   2. the action is not on the trusted-prices path, so a price that DID
    //      arrive would still be ignored
    //
    // Testing only through the endpoint proves the first and quietly claims the
    // second. Flipping `trusted_prices` to true there changes nothing, because
    // the field was already gone — a mutation caught exactly that.

    public function test_the_server_prices_the_cart_itself(): void
    {
        $result = $this->sync([$this->operation(sale: [
            'items' => [['product_id' => $this->product->id, 'quantity' => 2, 'unit_price' => 1]],
        ])])->assertOk()->json('data.results.0');

        $sale = Sale::withoutTenancy()->find($result['sale_id']);
        $this->assertEqualsWithDelta(200.0, (float) $sale->total, 0.001);
    }

    public function test_a_price_sent_by_a_till_does_not_survive_validation(): void
    {
        $request = SyncRequest::create('/api/v1/pos/sync', 'POST');
        $request->setUserResolver(fn (): User => $this->cashier);

        $validated = validator([
            'operations' => [$this->operation(sale: [
                'items' => [['product_id' => $this->product->id, 'quantity' => 2, 'unit_price' => 1]],
            ])],
        ], $request->rules())->validate();

        $this->assertArrayNotHasKey('unit_price', $validated['operations'][0]['sale']['items'][0]);
    }

    public function test_a_price_that_somehow_arrived_would_still_be_ignored(): void
    {
        // Straight past the request, which is the only way to reach the second
        // guard at all. This is the one that fails if the sync path is ever
        // moved onto the trusted-prices flag.
        $this->be($this->cashier);
        app(TenantContext::class)->set($this->tenant);

        $sale = app(CreateSaleAction::class)->execute([
            'channel' => 'pos',
            'items' => [['product_id' => $this->product->id, 'quantity' => 2, 'unit_price' => 1]],
            'payment_method' => 'cash',
            'amount_paid' => 500,
            'trusted_offline' => true,
            'trusted_prices' => false,
        ]);

        $this->assertEqualsWithDelta(200.0, (float) $sale->total, 0.001);
    }

    // ── The sale is never doubled ───────────────────────────────────

    public function test_the_same_operation_sent_three_times_is_one_sale(): void
    {
        $operation = $this->operation();

        $this->sync([$operation])->assertOk();
        $this->sync([$operation])->assertOk();
        $second = $this->sync([$operation])->assertOk()->json('data.results.0');

        $this->assertSame('duplicate', $second['status']);
        $this->assertSame(1, Sale::withoutTenancy()->count());
    }

    public function test_a_replay_returns_the_original_sale_rather_than_an_error(): void
    {
        // The till needs the invoice number to reconcile its slip. A replay
        // that answered "already done" with nothing attached would leave the
        // queue unable to retire the row it just successfully sent.
        $operation = $this->operation();
        $first = $this->sync([$operation])->assertOk()->json('data.results.0');
        $again = $this->sync([$operation])->assertOk()->json('data.results.0');

        $this->assertSame($first['sale_id'], $again['sale_id']);
        $this->assertSame($first['invoice_number'], $again['invoice_number']);
    }

    public function test_two_different_operations_are_two_sales(): void
    {
        // The mirror of the test above: idempotency that swallowed genuinely
        // separate sales would be far worse than one that let a duplicate past.
        $this->sync([$this->operation(), $this->operation(['offline_number' => 'OFF-L1-AB-000002'])])
            ->assertOk();

        $this->assertSame(2, Sale::withoutTenancy()->count());
    }

    // ── One bad operation must not cost the others ──────────────────

    public function test_a_malformed_operation_is_refused_before_anything_is_written(): void
    {
        $good = $this->operation();
        $bad = $this->operation(['offline_number' => 'OFF-L1-AB-000002'], [
            'items' => [['product_id' => (string) Str::uuid(), 'quantity' => 1]],
        ]);

        // A product id that does not exist fails validation for the WHOLE
        // batch, which is the wrong shape — so the sync must reject it at the
        // request layer rather than half-applying.
        $this->sync([$good, $bad])->assertStatus(422);

        // ... and nothing was written, so the till still holds both.
        $this->assertSame(0, Sale::withoutTenancy()->count());
    }

    public function test_one_operation_failing_in_the_action_leaves_the_rest_applied(): void
    {
        // A discount over the ceiling is refused by the action, not by
        // validation. Fifty queued sales must not be lost to one of them.
        $good = $this->operation();
        $bad = $this->operation(['offline_number' => 'OFF-L1-AB-000002'], [
            'discount' => 999999,
        ]);

        $results = $this->sync([$good, $bad])->assertOk()->json('data.results');

        $this->assertSame('applied', $results[0]['status']);
        $this->assertSame('failed', $results[1]['status']);
        $this->assertSame(1, Sale::withoutTenancy()->count());
    }

    public function test_an_empty_batch_is_refused_rather_than_silently_succeeding(): void
    {
        // A till that sent nothing and was told "synced" would retire a queue
        // it never actually emptied.
        $this->sync([])->assertStatus(422);
    }

    public function test_a_failure_says_whether_sending_it_again_could_ever_help(): void
    {
        // A till that retries a permanent failure for ever never empties its
        // queue and never tells anybody why.
        $results = $this->sync([$this->operation(sale: ['discount' => 999999])])
            ->assertOk()->json('data.results');

        $this->assertFalse($results[0]['retryable']);
        $this->assertNotNull($results[0]['message']);
    }

    // ── The policy: flagged, never corrected, never lost ────────────

    public function test_a_tender_offline_was_not_allowed_to_take_is_recorded_and_flagged(): void
    {
        // Rewriting a credit sale into a cash one would leave the shop
        // believing it had been paid — worse than any refusal. It is recorded
        // exactly as it happened and marked for the owner.
        Customer::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Ali', 'phone' => '+923001234567',
        ]);

        // The buyer is linked by phone, which is how the online sale does it —
        // the request has no `customer_id`.
        $result = $this->sync([$this->operation(sale: [
            'payment_method' => 'credit',
            'amount_paid' => 200,
            'customer_phone' => '+923001234567',
            'customer_name' => 'Ali',
        ])])->assertOk()->json('data.results.0');

        $this->assertSame('applied', $result['status']);
        $this->assertNotEmpty($result['violations']);

        $sale = Sale::withoutTenancy()->find($result['sale_id']);
        $this->assertSame('credit', $sale->payment_method->value);
        $this->assertNotNull($sale->offline_violations);
    }

    public function test_a_clean_sale_carries_no_flags(): void
    {
        $result = $this->sync([$this->operation()])->assertOk()->json('data.results.0');

        $this->assertSame([], $result['violations']);
        $this->assertNull(Sale::withoutTenancy()->find($result['sale_id'])->offline_violations);
    }

    public function test_a_dine_in_tab_rung_offline_is_flagged(): void
    {
        $result = $this->sync([$this->operation(sale: ['order_type' => 'dine_in'])])
            ->assertOk()->json('data.results.0');

        $this->assertNotEmpty($result['violations']);
    }

    // ── The ITEM was never sellable offline ─────────────────────────
    //
    // Of the offline rules this is the only one drawn on the LINE rather than
    // the sale, and it was enforced only on the till. The till's refusal is a
    // user interface: the queue behind it is a browser database on a tablet
    // that may have left the shop. So these arrived, applied, and were recorded
    // as clean offline sales — nothing flagged, nothing in the report, nobody
    // ever looking.
    //
    // It is also the rule with the worst ending. The other four cost a shop
    // money or an argument; these two are a regulatory event and one handset
    // sold twice.

    private function medicine(): Product
    {
        return Product::query()->create([
            'tenant_id' => $this->tenant->id,
            'type' => 'product',
            'item_type' => 'medicine',
            'name' => 'Augmentin 625',
            'price' => 180,
            'stock_quantity' => 50,
            'track_inventory' => true,
            'is_active' => true,
        ]);
    }

    public function test_a_medicine_rung_offline_is_recorded_and_flagged(): void
    {
        $med = $this->medicine();

        $result = $this->sync([$this->operation(sale: [
            'items' => [['product_id' => $med->id, 'quantity' => 2]],
        ])])->assertOk()->json('data.results.0');

        // The money crossed the counter and the box left the shop. Refusing it
        // would delete the record of both.
        $this->assertSame('applied', $result['status']);

        // Named, because this is read in a report a week later rather than at
        // the counter with the item in hand.
        $this->assertNotEmpty($result['violations']);
        $this->assertStringContainsString('Augmentin 625', $result['violations'][0]);
        $this->assertStringContainsString('expiry', $result['violations'][0]);

        $this->assertNotNull(Sale::withoutTenancy()->find($result['sale_id'])->offline_violations);
    }

    public function test_a_serial_tracked_item_rung_offline_is_recorded_and_flagged(): void
    {
        // Two tills with no line each sell the same IMEI, and each prints a
        // receipt. The shop owns one handset.
        $handset = Product::query()->create([
            'tenant_id' => $this->tenant->id,
            'type' => 'product',
            'item_type' => 'physical_product',
            'tracks_serial' => true,
            'name' => 'Handset X',
            'price' => 90000,
            'stock_quantity' => 5,
            'track_inventory' => true,
            'is_active' => true,
        ]);

        $result = $this->sync([$this->operation(sale: [
            'items' => [['product_id' => $handset->id, 'quantity' => 1]],
            'amount_paid' => 90000,
        ])])->assertOk()->json('data.results.0');

        $this->assertSame('applied', $result['status']);
        $this->assertStringContainsString('Handset X', $result['violations'][0]);
        $this->assertStringContainsString('serial', $result['violations'][0]);
    }

    public function test_the_same_medicine_on_two_lines_is_one_thing_to_tell_the_owner(): void
    {
        // A report that says the same sentence twice for one bill trains the
        // person reading it to skim.
        $med = $this->medicine();

        $result = $this->sync([$this->operation(sale: [
            'items' => [
                ['product_id' => $med->id, 'quantity' => 1],
                ['product_id' => $med->id, 'quantity' => 3],
            ],
            'amount_paid' => 720,
        ])])->assertOk()->json('data.results.0');

        $this->assertCount(1, $result['violations']);
    }

    public function test_an_ordinary_item_is_not_flagged_by_the_item_rule(): void
    {
        // The half that stops this becoming a check which flags everything. A
        // report where every sale is flagged is a report nobody reads — and a
        // mart's whole catalog goes through this path.
        $result = $this->sync([$this->operation()])->assertOk()->json('data.results.0');

        $this->assertSame([], $result['violations']);
    }

    public function test_a_week_of_sales_asks_the_catalog_once(): void
    {
        // The property that keeps the check affordable. A tablet dark for a
        // week arrives with a batch, and "is this a medicine" does not change
        // between its sales — asking per sale would be a round trip each for
        // one query's worth of truth.
        $med = $this->medicine();

        $operations = [];
        for ($i = 0; $i < 12; $i++) {
            $operations[] = $this->operation(sale: [
                'items' => [['product_id' => $med->id, 'quantity' => 1]],
            ]);
        }

        DB::enableQueryLog();
        $this->sync($operations)->assertOk();
        $log = DB::getQueryLog();
        DB::disableQueryLog();

        $lookups = count(array_filter(
            $log,
            fn (array $q): bool => str_contains($q['query'], 'from "products"')
                && str_contains($q['query'], '"id" in ('),
        ));

        $this->assertSame(1, $lookups, 'the refusal map is resolved once per request, not once per sale');
    }

    // ── Out of stock does not refuse ────────────────────────────────

    public function test_selling_more_than_the_shelf_held_is_recorded_not_refused(): void
    {
        // The goods have already left the shop. Refusing the sale would delete
        // the record of that, and the stock figure would still be wrong — just
        // wrong AND missing a sale.
        $result = $this->sync([$this->operation(sale: [
            'items' => [['product_id' => $this->product->id, 'quantity' => 9999]],
            'amount_paid' => 999900,
        ])])->assertOk()->json('data.results.0');

        $this->assertSame('applied', $result['status']);
    }

    // ── Late is MARKED, never refused ───────────────────────────────
    //
    // A shop's plan says how many days a till may trade without checking in.
    // Exceeding it is a thing the owner must be told about — it is not a thing
    // the server may undo, because the sales already happened.
    //
    // The measurement is "how long had this till been away WHEN IT RANG THIS",
    // not "how old is this sale now". A till whose outbox sat unsent for a
    // month still rang its first day's sales on its first day, and those were
    // never outside anybody's window.

    private function lateness(array $over, array $sale = []): bool
    {
        $result = $this->sync([$this->operation($over, $sale)])->assertOk()->json('data.results.0');

        $this->assertSame('applied', $result['status'], 'A late sale must still land.');

        return (bool) Sale::withoutTenancy()->find($result['sale_id'])->beyond_offline_window;
    }

    public function test_a_sale_rung_long_past_the_shops_window_is_marked_and_kept(): void
    {
        // Thirty-five days into a three-day allowance. The goods are gone and
        // the money is in the drawer; the only useful thing left to do is say
        // so.
        $this->assertTrue($this->lateness([
            'offline_since' => now()->subDays(40)->toIso8601String(),
            'at' => now()->subDays(5)->toIso8601String(),
        ]));
    }

    public function test_a_forty_day_outbox_syncs_in_full(): void
    {
        // The whole month arrives at once when the line comes back. Not one
        // operation may be refused for being old, and the marking has to
        // separate the first days from the rest rather than condemning all of
        // them.
        $since = now()->subDays(40);
        $operations = [];
        foreach ([1, 2, 20, 39] as $day) {
            $operations[] = $this->operation([
                'offline_since' => $since->toIso8601String(),
                'at' => $since->copy()->addDays($day)->toIso8601String(),
                'offline_number' => 'OFF-L1-AB-'.Str::random(6),
            ]);
        }

        $results = $this->sync($operations)->assertOk()->json('data');

        $this->assertSame(4, $results['accepted']);
        $marked = Sale::withoutTenancy()
            ->whereIn('id', array_column($results['results'], 'sale_id'))
            ->pluck('beyond_offline_window')
            ->map(fn ($v): bool => (bool) $v)
            ->all();

        // Days 1 and 2 were inside a three-day allowance; days 20 and 39 were
        // not. All four are recorded either way.
        $this->assertSame([false, false, true, true], $marked);
    }

    public function test_lateness_is_measured_from_the_last_contact_and_not_from_today(): void
    {
        // A till that went dark on the 1st and rang this on the 2nd was one
        // day out, and stays one day out however long its outbox then sat
        // waiting for a line. Measuring from today would condemn every sale a
        // long outage produced, including the ones rung well inside the rules.
        $this->assertFalse($this->lateness([
            'offline_since' => now()->subDays(40)->toIso8601String(),
            'at' => now()->subDays(39)->toIso8601String(),
        ]));
    }

    public function test_a_till_that_never_said_when_it_last_checked_in_is_not_accused(): void
    {
        // Nothing to measure from. Claiming lateness on a guess is how a
        // report full of false marks teaches an owner to skip it.
        $this->assertFalse($this->lateness(['at' => now()->subDays(90)->toIso8601String()]));
    }

    // ── The device ──────────────────────────────────────────────────

    public function test_it_records_which_till_rang_the_sale(): void
    {
        $id = (string) Str::uuid();
        $this->actingAsUser($this->cashier)
            ->postJson('/api/v1/pos/devices', ['device_id' => $id, 'name' => 'Lane 1'])
            ->assertOk();

        $result = $this->sync([$this->operation()], $id)->assertOk()->json('data.results.0');

        $this->assertSame($id, Sale::withoutTenancy()->find($result['sale_id'])->pos_device_id);
    }

    public function test_an_unknown_device_costs_the_attribution_and_not_the_sale(): void
    {
        $result = $this->sync([$this->operation()], (string) Str::uuid())
            ->assertOk()->json('data.results.0');

        $this->assertSame('applied', $result['status']);
        $this->assertNull(Sale::withoutTenancy()->find($result['sale_id'])->pos_device_id);
    }

    // ── The shift ───────────────────────────────────────────────────

    public function test_a_sale_from_a_shift_that_has_since_closed_still_lands(): void
    {
        // Tuesday's drawer was counted and closed on Tuesday night. The sale
        // arriving on Friday is still Tuesday's money, and refusing it because
        // the drawer is shut throws away the record of cash already in it.
        $session = CashSession::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            'user_id' => $this->cashier->id,
            'opening_float' => 0,
            'opened_at' => now()->subDays(3),
            'closed_at' => now()->subDays(3)->addHours(8),
            'status' => 'closed',
        ]);

        $result = $this->sync([$this->operation(sale: ['cash_session_id' => $session->id])])
            ->assertOk()->json('data.results.0');

        $this->assertSame('applied', $result['status']);
    }

    // ── The day that was already signed off ─────────────────────────

    /** The branch every sale in this test lands on. */
    private function mainBranch(): string
    {
        return Branch::withoutTenancy()->where('tenant_id', $this->tenant->id)->value('id');
    }

    private function day(string $tradingDate, string $status, ?string $branchId = null): BusinessDay
    {
        return BusinessDay::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            // The shop's day is per BRANCH. A day closed at Gulberg says
            // nothing about a sale rung at Saddar, and matching on the date
            // alone would flag every other branch's sales the moment one
            // branch signed off.
            'branch_id' => $branchId ?? $this->mainBranch(),
            'trading_date' => $tradingDate,
            'status' => $status,
            'opened_by' => $this->cashier->id,
            'opened_at' => Carbon::parse($tradingDate)->setTime(9, 0),
            'closed_by' => $status === BusinessDay::STATUS_CLOSED ? $this->cashier->id : null,
            'closed_at' => $status === BusinessDay::STATUS_CLOSED
                ? Carbon::parse($tradingDate)->setTime(22, 0)
                : null,
            'sales_total' => 5000,
            'counted_cash' => 5000,
            'variance' => 0,
        ]);
    }

    public function test_a_sale_arriving_after_its_day_was_closed_is_kept_and_named(): void
    {
        // The owner counted Tuesday, closed it and banked the cash. Wednesday
        // morning, Tuesday's sales arrive.
        $tuesday = now()->subDays(2);
        $day = $this->day($tuesday->toDateString(), BusinessDay::STATUS_CLOSED);

        $result = $this->sync([$this->operation(['at' => $tuesday->copy()->setTime(14, 0)->toIso8601String()])])
            ->assertOk()->json('data.results.0');

        $this->assertSame('applied', $result['status']);
        $this->assertTrue((bool) Sale::withoutTenancy()->find($result['sale_id'])->after_day_close);

        // And the signed-off figures do NOT move. This is the half that must
        // never be "helpfully" fixed: recomputing Tuesday would change a
        // variance somebody had already accepted and put their name to.
        $this->assertSame('5000.00', $day->fresh()->sales_total);
        $this->assertSame('0.00', $day->fresh()->variance);
    }

    public function test_a_sale_whose_day_is_stil_l_ope_n_is_not_named(): void
    {
        // The day exists and has not been signed off, so this sale is in the
        // totals the owner will count tonight. Flagging it would send somebody
        // looking for a shortfall that does not exist — and a day must be here
        // for the test to prove anything: with no day at all, the flag stays
        // false whether the status is checked or not, and a mutation that
        // dropped the status filter sailed through exactly that.
        $tuesday = now()->subDays(2);
        $this->day($tuesday->toDateString(), BusinessDay::STATUS_OPEN);

        $result = $this->sync([$this->operation(['at' => $tuesday->copy()->setTime(14, 0)->toIso8601String()])])
            ->assertOk()->json('data.results.0');

        $this->assertFalse((bool) Sale::withoutTenancy()->find($result['sale_id'])->after_day_close);
    }

    public function test_another_branchs_closed_day_says_nothing_about_this_sale(): void
    {
        // Gulberg signed off at ten; Saddar is still trading. Matching on the
        // date alone would flag every Saddar sale the moment Gulberg closed,
        // and a report where everything is flagged is a report nobody reads.
        $tuesday = now()->subDays(2);
        $gulberg = Branch::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Gulberg', 'is_default' => false,
        ]);
        $this->day($tuesday->toDateString(), BusinessDay::STATUS_CLOSED, $gulberg->id);

        $result = $this->sync([$this->operation(['at' => $tuesday->copy()->setTime(14, 0)->toIso8601String()])])
            ->assertOk()->json('data.results.0');

        $this->assertFalse((bool) Sale::withoutTenancy()->find($result['sale_id'])->after_day_close);
    }

    public function test_the_trading_date_is_read_in_the_shops_timezone(): void
    {
        // The shop's day is opened and closed against the shop's own calendar
        // — `trading_date` is written from the tenant's local date. A till that
        // reports in UTC must land on the same date, or a Karachi shop's
        // late-evening sales would be filed against yesterday and the flag
        // would misfire on exactly the hours a power cut is most likely.
        $this->tenant->update(['timezone' => 'Asia/Karachi']);

        // 20:00 UTC is 01:00 the NEXT day in Karachi — the one window where
        // the two calendars disagree.
        $utc = now()->subDays(2)->setTime(20, 0)->setTimezone('UTC');
        $shopDate = $utc->copy()->setTimezone('Asia/Karachi')->toDateString();
        $this->assertNotSame($utc->toDateString(), $shopDate, 'The fixture must straddle midnight to prove anything.');

        $this->day($shopDate, BusinessDay::STATUS_CLOSED);

        $result = $this->sync([$this->operation(['at' => $utc->toIso8601String()])])
            ->assertOk()->json('data.results.0');

        $this->assertTrue((bool) Sale::withoutTenancy()->find($result['sale_id'])->after_day_close);
    }

    // ── Practice, and the one way a sale could be hidden ────────────
    //
    // Online, a training sale is LOUD — a banner across the screen, TRAINING
    // printed on the slip, a TRN- number. Nobody rings a real customer on a
    // practice drawer without the customer seeing it.
    //
    // A synced sale has none of that. The shift is named by a client, hours
    // later, and it no longer has to be open or the caller's — so the shift
    // alone deciding would mean one swapped id turns a real sale into one
    // that takes no stock, earns no revenue and appears in no report.
    //
    // Practice therefore needs BOTH the drawer and the till to say so. The
    // till can only ever withhold it, never grant it.

    private function shift(bool $training): CashSession
    {
        return CashSession::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            'user_id' => $this->cashier->id,
            'opening_float' => 0,
            'opened_at' => now()->subDays(3),
            'status' => 'open',
            'is_training' => $training,
        ]);
    }

    public function test_a_practice_sale_rung_offline_is_still_practice_when_it_syncs(): void
    {
        $shift = $this->shift(training: true);

        $result = $this->sync([$this->operation(
            ['training' => true],
            ['cash_session_id' => $shift->id],
        )])->assertOk()->json('data.results.0');

        $this->assertSame('applied', $result['status']);

        $sale = Sale::withoutTenancy()->withoutGlobalScopes()->find($result['sale_id']);
        $this->assertTrue((bool) $sale->is_training);
        // A separate number series: the real one is gap-free because a tax
        // authority reads a hole in it as a deleted sale.
        $this->assertStringStartsWith('TRN-', $sale->invoice_number);
        // Practice takes nothing off the shelf.
        $this->assertSame(50.0, (float) $this->product->fresh()->stock_quantity);
        // And it is fenced out of every figure the shop reads.
        $this->assertNull(Sale::withoutTenancy()->find($result['sale_id']));
        $this->assertSame([], $result['violations']);
    }

    public function test_naming_a_practice_shift_cannot_hide_a_real_sale(): void
    {
        // The attack: ring real customers offline all day, then sync naming a
        // practice shift. Without the second opinion the goods walk out and
        // no report ever shows it.
        $shift = $this->shift(training: true);

        $result = $this->sync([$this->operation(
            [],
            ['cash_session_id' => $shift->id],
        )])->assertOk()->json('data.results.0');

        $this->assertSame('applied', $result['status']);

        $sale = Sale::withoutTenancy()->find($result['sale_id']);
        // Recorded, not refused — and recorded as REAL.
        $this->assertNotNull($sale);
        $this->assertFalse((bool) $sale->is_training);
        $this->assertStringStartsWith('INV-', $sale->invoice_number);
        // The goods left the shop, so the shelf moves.
        $this->assertSame(48.0, (float) $this->product->fresh()->stock_quantity);
        // And the owner is told, because a silent correction teaches nobody.
        $this->assertNotEmpty($result['violations']);
    }

    public function test_the_till_alone_cannot_turn_a_real_shift_into_practice(): void
    {
        // The opposite direction, and the reason the till's word is a veto
        // rather than a vote: a client-supplied "this one is practice" flag
        // would be a switch for making stock and money disappear.
        $shift = $this->shift(training: false);

        $result = $this->sync([$this->operation(
            ['training' => true],
            ['cash_session_id' => $shift->id],
        )])->assertOk()->json('data.results.0');

        $sale = Sale::withoutTenancy()->find($result['sale_id']);
        $this->assertFalse((bool) $sale->is_training);
        $this->assertSame(48.0, (float) $this->product->fresh()->stock_quantity);
        $this->assertNotEmpty($result['violations']);
    }

    public function test_a_real_sale_on_a_real_shift_raises_nothing(): void
    {
        // The ordinary case, and the one that proves the flag is not simply
        // always on — a warning that fires on every sale is a warning nobody
        // reads.
        $shift = $this->shift(training: false);

        $result = $this->sync([$this->operation(
            ['training' => false],
            ['cash_session_id' => $shift->id],
        )])->assertOk()->json('data.results.0');

        $this->assertSame('applied', $result['status']);
        $this->assertSame([], $result['violations']);
    }

    public function test_a_sale_with_no_shift_at_all_raises_nothing(): void
    {
        // A shop that does not run shifts still sells. There is nothing for
        // the two opinions to disagree about, so there is nothing to say.
        $result = $this->sync([$this->operation(['training' => false])])
            ->assertOk()->json('data.results.0');

        $this->assertSame([], $result['violations']);
    }

    // ── Permission and tenancy ──────────────────────────────────────

    public function test_someone_without_sales_manage_cannot_sync(): void
    {
        $reader = User::factory()->tenantStaff($this->tenant, ['products.view'])->create();

        $this->actingAsUser($reader)
            ->postJson('/api/v1/pos/sync', ['operations' => [$this->operation()]])
            ->assertForbidden();
    }

    public function test_a_batch_bigger_than_the_ceiling_is_refused(): void
    {
        $operations = [];
        for ($i = 0; $i < 51; $i++) {
            $operations[] = $this->operation(['offline_number' => "OFF-L1-AB-{$i}"]);
        }

        $this->sync($operations)->assertStatus(422);
    }

    public function test_one_shops_sale_cannot_be_synced_against_anothers_product(): void
    {
        $other = Tenant::factory()->create(['setup_completed' => true]);
        $theirs = Product::query()->create([
            'tenant_id' => $other->id,
            'type' => 'product',
            'item_type' => 'physical_product',
            'name' => 'Theirs',
            'price' => 100,
        ]);

        $this->sync([$this->operation(sale: [
            'items' => [['product_id' => $theirs->id, 'quantity' => 1]],
        ])])->assertStatus(422);
    }

    // ── A till whose clock is wrong (P4-4) ──────────────────────────
    //
    // `sold_at` is not a display field. It decides the trading day, the shift,
    // whose figures the sale lands in, and whether the day it belongs to had
    // already been counted and banked. It arrives from a tablet, and a tablet
    // that has been flat for a week comes back believing it is the day it
    // shipped. Two layers answer that: the till corrects itself against
    // `server_time`, and the server refuses to file anything OUTSIDE what is
    // possible — never in the future, never before the till's last contact.

    public function test_a_clock_running_days_slo_w_cannot_file_a_sale_before_the_till_was_last_in_touch(): void
    {
        // The till was with us an hour ago. It now claims this sale happened
        // three days ago, which cannot be true — three days ago it was online,
        // and an online sale never comes through here at all.
        $contact = now()->subHour();

        $result = $this->sync([$this->operation([
            'at' => now()->subDays(3)->toIso8601String(),
            'offline_since' => $contact->toIso8601String(),
        ])])->assertOk()->json('data.results.0');

        $sale = Sale::withoutTenancy()->find($result['sale_id']);
        $this->assertSame($contact->toDateString(), $sale->sold_at->toDateString());
        $this->assertTrue($sale->sold_at->greaterThanOrEqualTo($contact->startOfSecond()));
    }

    public function test_a_clock_running_fas_t_cannot_file_a_sale_into_a_day_nobody_has_traded_yet(): void
    {
        // The other direction, and it needs no help from the till at all: the
        // server's own clock says tomorrow has not happened. A sale filed
        // forward sits ahead of the books until that day arrives, and lands in
        // a business day that will be opened and closed around it.
        $result = $this->sync([$this->operation([
            'at' => now()->addDays(2)->toIso8601String(),
        ])])->assertOk()->json('data.results.0');

        $sale = Sale::withoutTenancy()->find($result['sale_id']);
        $this->assertSame(now()->toDateString(), $sale->sold_at->toDateString());
    }

    public function test_a_genuinely_old_sale_is_left_exactly_where_it_says_it_happened(): void
    {
        // The bound must not become a rewrite. A till away for forty days rang
        // real sales on every one of them, and each belongs to its own day —
        // this is the case that makes the correction safe to have at all.
        $rang = now()->subDays(40)->startOfHour();

        $result = $this->sync([$this->operation([
            'at' => $rang->toIso8601String(),
            'offline_since' => now()->subDays(41)->toIso8601String(),
        ])])->assertOk()->json('data.results.0');

        $sale = Sale::withoutTenancy()->find($result['sale_id']);
        $this->assertSame($rang->toDateString(), $sale->sold_at->toDateString());
        $this->assertSame(0, $sale->clock_skew_seconds);
    }

    public function test_a_till_with_no_record_of_its_last_contact_still_syncs(): void
    {
        // A fresh device, a cleared browser, a build too old to send it. There
        // is no floor to measure against, and refusing over a missing field
        // would throw away a sale that already happened.
        $rang = now()->subDays(2)->startOfHour();

        $result = $this->sync([$this->operation([
            'at' => $rang->toIso8601String(),
            'offline_since' => null,
        ])])->assertOk()->json('data.results.0');

        $this->assertSame('applied', $result['status']);
        $this->assertSame(
            $rang->toDateString(),
            Sale::withoutTenancy()->find($result['sale_id'])->sold_at->toDateString(),
        );
    }

    public function test_the_tablets_own_wrong_reading_is_kep_t_so_somebody_fixes_the_clock(): void
    {
        // A correction nobody can see is a tablet that goes on being three days
        // out every morning for ever. This is the only way the shop ever finds
        // out there is a clock to set.
        $wrong = now()->subDays(3);

        $result = $this->sync([$this->operation([
            'at' => now()->subMinutes(5)->toIso8601String(),
            'client_at' => $wrong->toIso8601String(),
            'offline_since' => now()->subHour()->toIso8601String(),
        ])])->assertOk()->json('data.results.0');

        $sale = Sale::withoutTenancy()->find($result['sale_id']);
        $this->assertSame($wrong->toDateString(), $sale->client_sold_at->toDateString());
        // Positive means the till was BEHIND. Three days, near enough.
        $this->assertEqualsWithDelta(3 * 86400, $sale->clock_skew_seconds, 600);
    }

    public function test_a_sale_rung_with_a_server_in_front_of_it_carries_no_clock_story_at_all(): void
    {
        // The online path shares this action. A `client_sold_at` on a sale that
        // was never offline would put every ordinary sale in the wrong-clock
        // report, which is how a report stops being read.
        $this->actingAsUser($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
            'payment_method' => 'cash',
            'amount_paid' => 200,
        ])->assertCreated();

        $sale = Sale::withoutTenancy()->whereNull('offline_number')->latest('created_at')->first();
        $this->assertNull($sale->client_sold_at);
        $this->assertNull($sale->clock_skew_seconds);
    }

    // ── Whose sale it was (P4-6) ────────────────────────────────────

    public function test_a_synced_sale_is_credited_to_the_cashier_who_ran_g_it(): void
    {
        // The queue is flushed by whoever reconnects — the evening cashier, a
        // manager, an owner opening up after a week. Without the till naming
        // the person who was standing at it, one cashier's entire outage lands
        // in another's staff report.
        $morning = User::factory()->tenantStaff($this->tenant, ['sales.manage'])->create();

        $result = $this->sync([$this->operation(['rung_by' => $morning->id])])
            ->assertOk()->json('data.results.0');

        $this->assertSame($morning->id, Sale::withoutTenancy()->find($result['sale_id'])->created_by);
    }

    public function test_a_sale_that_names_nobody_is_credited_to_whoever_sent_it(): void
    {
        // A row written by a build older than the field. Somebody is better
        // than nobody: an unattributed sale is invisible in every staff report.
        $result = $this->sync([$this->operation()])->assertOk()->json('data.results.0');

        $this->assertSame($this->cashier->id, Sale::withoutTenancy()->find($result['sale_id'])->created_by);
    }

    public function test_a_till_cannot_credit_a_sale_to_someone_from_another_shop(): void
    {
        // The one thing that makes accepting a client-named user safe at all.
        $stranger = User::factory()->create();

        $result = $this->sync([$this->operation(['rung_by' => $stranger->id])])
            ->assertOk()->json('data.results.0');

        $this->assertSame($this->cashier->id, Sale::withoutTenancy()->find($result['sale_id'])->created_by);
    }

    public function test_a_till_cannot_credit_a_sale_to_someone_who_has_been_switched_off(): void
    {
        // A cashier who left. Their figures are closed, and reopening them from
        // a queue somebody kept is exactly the kind of quiet edit a shop cannot
        // see happening.
        $gone = User::factory()->tenantStaff($this->tenant, ['sales.manage'])->create();
        $gone->forceFill(['status' => 'suspended'])->save();

        $result = $this->sync([$this->operation(['rung_by' => $gone->id])])
            ->assertOk()->json('data.results.0');

        $this->assertSame($this->cashier->id, Sale::withoutTenancy()->find($result['sale_id'])->created_by);
    }

    // ── A tablet that was carried somewhere else (P5-5) ─────────────

    public function test_a_till_carried_to_another_branch_still_files_its_queue_at_home(): void
    {
        // The tablet was registered on Gulberg and walked to Saddar in a bag.
        // The moment it reconnects there the branch header says Saddar — and a
        // week of Gulberg's unsent sales would land in Saddar's books and come
        // off Saddar's shelf. Twice wrong in one step, and invisible in both.
        $home = Branch::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Gulberg', 'is_active' => true,
        ]);
        $away = Branch::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Saddar', 'is_active' => true,
        ]);

        $device = PosDevice::query()->create([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->tenant->id,
            'branch_id' => $home->id,
            'name' => 'Counter tablet',
            'last_seen_at' => now(),
        ]);

        $result = $this->actingAsUser($this->cashier)
            ->withHeader('X-Branch-Id', $away->id)
            ->postJson('/api/v1/pos/sync', [
                'device_id' => $device->id,
                'operations' => [$this->operation()],
            ])->assertOk()->json('data.results.0');

        $this->assertSame($home->id, Sale::withoutTenancy()->find($result['sale_id'])->branch_id);
    }

    public function test_a_till_with_no_branch_of_its_own_uses_the_one_it_is_signed_in_at(): void
    {
        // A shop with one counter registers devices before there is a lane to
        // assign them to. Refusing those sales would be refusing over a field
        // that is protecting nothing.
        $device = PosDevice::query()->create([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->tenant->id,
            'branch_id' => null,
            'name' => 'The only tablet',
            'last_seen_at' => now(),
        ]);

        $result = $this->sync([$this->operation()], $device->id)->assertOk()->json('data.results.0');

        $this->assertSame('applied', $result['status']);
        $this->assertNotNull(Sale::withoutTenancy()->find($result['sale_id'])->branch_id);
    }

    public function test_the_staff_report_shows_a_synced_sale_against_the_person_who_rang_it(): void
    {
        // The end-to-end of the rule above, and the only version of it that
        // proves anything a shop can see. A `created_by` written correctly and
        // then read by a report that filters on the wrong date, or excludes
        // offline sales, is still a cashier whose day disappeared.
        $morning = User::factory()->tenantStaff($this->tenant, ['sales.manage'])->create();
        $rang = now()->subDays(2)->setTime(11, 0);

        $this->sync([$this->operation([
            'at' => $rang->toIso8601String(),
            'rung_by' => $morning->id,
            'offline_since' => now()->subDays(3)->toIso8601String(),
        ])])->assertOk();

        $owner = User::factory()->shopOwner($this->tenant)->create();
        $report = $this->actingAsUser($owner)
            ->getJson('/api/v1/reports/staff?from='.now()->subDays(7)->toDateString().'&to='.now()->toDateString())
            ->assertOk()->json('data.staff');

        $row = collect($report)->firstWhere('staff_id', $morning->id);
        $this->assertNotNull($row, 'A cashier who rang sales must appear in the staff report at all.');
        $this->assertSame(1, $row['sales_count']);
        $this->assertEqualsWithDelta(200.0, $row['revenue'], 0.001);

        $this->assertNull(
            collect($report)->firstWhere('staff_id', $this->cashier->id),
            'The person who merely flushed the queue must not be credited with the sale.',
        );
    }
}
