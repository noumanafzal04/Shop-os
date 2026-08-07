<?php

namespace Tests\Feature;

use App\Models\BusinessDay;
use App\Models\CashSession;
use App\Models\City;
use App\Models\Customer;
use App\Models\Product;
use App\Models\Sale;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Somewhere a new cashier can learn the till without it costing anything.
 *
 * The unit is the SHIFT, not the sale. A per-sale switch lets practice and real
 * money mix in one drawer, and the mistake it invites — forgetting to switch
 * back — is the one that must be impossible. So you open a shift in training,
 * everything rung on it is practice, and the mode cannot change while it runs.
 *
 * Two structural fences, chosen over "remember to filter it":
 *
 *   A GLOBAL SCOPE on Sale. Practice is invisible to every query that does not
 *   explicitly ask for it — the same mechanism this codebase already trusts for
 *   tenant isolation, and for the same reason: what must never leak cannot
 *   depend on every future report remembering to exclude it.
 *
 *   NO BUSINESS DAY. A training shift belongs to no trading day, and the day's
 *   roll-up gathers its sessions by business_day_id. Practice is not filtered
 *   out of the day's takings; it was never in them.
 *
 * What training deliberately REFUSES is as important as what it allows. Khata,
 * loyalty, serials and trade-ins all reach outside the sale and touch a real
 * record. Each could be silently skipped, and each skip would be a quiet lie —
 * a khata sale that charged nobody, a serial sold twice. Refusing says so.
 */
class TrainingModeTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $trainee;

    private Product $rice;

    /** What a trade-in is booked in as — a real product row, like any stock. */
    private Product $scrap;

    private ?string $sessionId = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Multan', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
            'timezone' => 'UTC',
        ]);

        $this->owner = User::factory()->shopOwner($this->shop)->create(['name' => 'Owner']);
        $this->trainee = User::factory()
            ->tenantStaff($this->shop, ['sales.manage'])->create(['name' => 'Nadia']);

        $this->rice = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product',
            'name' => 'Basmati 5kg', 'price' => 2500, 'cost' => 2000,
            'track_inventory' => true, 'stock_quantity' => 100, 'is_active' => true,
        ]);

        $this->scrap = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product',
            'name' => 'Scrap battery', 'price' => 500, 'cost' => 300,
            'track_inventory' => true, 'stock_quantity' => 0, 'is_active' => true,
        ]);
    }

    // ── The shift ───────────────────────────────────────────────────

    public function test_a_training_shift_belongs_to_no_trading_day(): void
    {
        $session = $this->openShift(training: true);

        $this->assertTrue($session['is_training']);
        $this->assertNull($session['business_day_id']);
        // Nothing opened a day on its behalf either.
        $this->assertSame(0, BusinessDay::withoutTenancy()->where('tenant_id', $this->shop->id)->count());
    }

    public function test_a_normal_shift_is_unchanged(): void
    {
        $session = $this->openShift();

        $this->assertFalse($session['is_training']);
        $this->assertNotNull($session['business_day_id']);
    }

    /**
     * The mistake the whole design exists to prevent: practising into a live
     * drawer, or ringing real money on a practice one.
     */
    public function test_the_mode_cannot_change_while_a_shift_is_open(): void
    {
        $this->openShift(training: true);

        $this->actingAsUser($this->trainee)
            ->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'SHIFT_MODE_MISMATCH');
    }

    // ── What a practice sale does not touch ─────────────────────────

    public function test_a_practice_sale_takes_nothing_off_the_shelf(): void
    {
        $this->openShift(training: true);
        $this->sell(2500);

        $this->assertEquals(100, Product::withoutTenancy()->find($this->rice->id)->stock_quantity);
        $this->assertSame(0, StockMovement::withoutTenancy()
            ->where('tenant_id', $this->shop->id)->count());
    }

    /**
     * The drift-catcher. A future feature that writes somewhere new during a
     * sale will fail here rather than being discovered in a revenue figure.
     * A practice sale may touch the sale itself and nothing else.
     */
    public function test_a_practice_sale_writes_nowhere_but_the_sale_itself(): void
    {
        $this->openShift(training: true);
        $this->sell(2500);

        $untouched = [
            'stock_movements', 'customer_ledger_entries', 'loyalty_ledger_entries',
            'sale_serials', 'sale_trade_ins', 'bank_deposits', 'business_days',
        ];

        foreach ($untouched as $table) {
            if (! DB::getSchemaBuilder()->hasTable($table)) {
                continue;
            }
            $this->assertSame(0, DB::table($table)->count(), "Training wrote to {$table}");
        }
    }

    public function test_practice_never_earns_loyalty_points(): void
    {
        $this->shop->forceFill(['settings' => [
            'loyalty_enabled' => true, 'loyalty_earn_per_amount' => 100,
        ]])->save();

        $this->openShift(training: true);
        $id = $this->sell(2500, extra: ['customer_phone' => '03001234567', 'customer_name' => 'Ali']);

        $this->assertSame(0, (int) Sale::withTraining()->find($id)->points_earned);
        $this->assertEquals(0, (int) (Customer::withoutTenancy()
            ->where('tenant_id', $this->shop->id)->first()?->loyalty_points ?? 0));
    }

    // ── What training refuses, and says so ──────────────────────────

    #[DataProvider('refusals')]
    public function test_training_refuses_what_would_touch_a_real_record(array $payload): void
    {
        $this->openShift(training: true);

        $this->actingAsUser($this->trainee)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'cash_session_id' => $this->sessionId,
            'items' => [['product_id' => $this->rice->id, 'quantity' => 1]],
            'payment_method' => 'cash',
            'amount_paid' => 2500,
            ...$payload,
        ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'TRAINING_NOT_AVAILABLE');
    }

    public static function refusals(): array
    {
        return [
            'khata' => [['payment_method' => 'credit', 'customer_phone' => '03001234567']],
            'loyalty redemption' => [['redeem_points' => 50, 'customer_phone' => '03001234567']],
        ];
    }

    /**
     * Its own test rather than a provider row: a trade-in needs a real product
     * to be booked in as, and validation runs before the training check — so a
     * made-up payload would be refused for the wrong reason and prove nothing.
     */
    public function test_training_refuses_a_trade_in(): void
    {
        $this->openShift(training: true);

        $this->actingAsUser($this->trainee)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'cash_session_id' => $this->sessionId,
            'items' => [['product_id' => $this->rice->id, 'quantity' => 1]],
            'payment_method' => 'cash',
            'amount_paid' => 2000,
            'trade_ins' => [['product_id' => $this->scrap->id, 'unit_allowance' => 500]],
        ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'TRAINING_NOT_AVAILABLE');
    }

    public function test_a_live_shift_still_allows_all_of_it(): void
    {
        // The same call the training shift refused, on a normal shift: the
        // refusals must be scoped to training and not a new rule for everyone.
        $this->openShift();

        $this->actingAsUser($this->trainee)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'cash_session_id' => $this->sessionId,
            'items' => [['product_id' => $this->rice->id, 'quantity' => 1]],
            'payment_method' => 'cash',
            'amount_paid' => 2000,
            'trade_ins' => [['product_id' => $this->scrap->id, 'unit_allowance' => 500]],
        ])->assertCreated();
    }

    // ── The fence around the numbers ────────────────────────────────

    public function test_practice_is_invisible_to_the_sales_list(): void
    {
        $this->openShift(training: true);
        $this->sell(2500);
        $this->closeShift();

        $this->openShift();
        $this->sell(2500);

        $list = $this->actingAsUser($this->owner)->getJson('/api/v1/sales')->assertOk()->json('data');

        $this->assertCount(1, $list);
        $this->assertStringStartsWith('INV-', $list[0]['invoice_number']);
    }

    /**
     * The figure the whole feature protects. A trainee's afternoon must not
     * appear in what the owner is told the shop took.
     */
    public function test_practice_never_reaches_the_shops_takings(): void
    {
        $this->openShift(training: true);
        $this->sell(2500);
        $this->sell(2500);
        $this->closeShift();

        $summary = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/reports/summary')->assertOk()->json('data');

        $this->assertEquals(0, (float) data_get($summary, 'sales.total', 0));
        $this->assertEquals(0, (int) data_get($summary, 'sales.count', 0));
    }

    /** The real sequence is gap-free on purpose; practice must not punch holes. */
    public function test_practice_takes_its_numbers_from_a_separate_sequence(): void
    {
        $this->openShift();
        $first = Sale::withTraining()->find($this->sell(2500))->invoice_number;
        $this->closeShift();

        $this->openShift(training: true);
        $practice = Sale::withTraining()->find($this->sell(2500))->invoice_number;
        $this->closeShift();

        $this->openShift();
        $second = Sale::withTraining()->find($this->sell(2500))->invoice_number;

        $this->assertSame('INV-000001', $first);
        $this->assertSame('TRN-000001', $practice);
        // The gap the training sale would have left, had it shared the counter.
        $this->assertSame('INV-000002', $second);
    }

    /**
     * A training shift is LISTED but never SUMMED. Dropping it would make a
     * real stretch of somebody's day vanish from the history; summing it would
     * put practice cash in the figure a manager reads as takings.
     */
    public function test_a_training_shift_shows_in_the_history_but_not_in_its_totals(): void
    {
        $this->openShift(training: true);
        $this->sell(2500);
        $this->closeShift();

        $history = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/pos/sessions')->assertOk()->json('data');

        $this->assertCount(1, $history['sessions']);
        $this->assertTrue($history['sessions'][0]['is_training']);

        $this->assertSame(0, $history['totals']['shifts']);
        $this->assertEquals(0, $history['totals']['sales_total']);
        $this->assertEquals(0, $history['totals']['cash_sales']);
    }

    // ── What the trainee still gets to see ──────────────────────────

    /**
     * The drawer must count. A trainee shown an expected cash of exactly their
     * opening float, while the till fills with notes, learns the wrong lesson
     * at the only moment the lesson lands.
     */
    public function test_the_practice_drawer_still_reconciles(): void
    {
        $this->openShift(training: true, float: 1000);
        $this->sell(2500);

        $x = $this->actingAsUser($this->trainee)
            ->getJson('/api/v1/pos/session/report')->assertOk()->json('data.drawer');

        $this->assertEquals(3500, $x['expected_cash']);
        $this->assertSame(1, $x['sales_count']);
    }

    public function test_a_practice_receipt_can_be_reprinted_and_says_what_it_is(): void
    {
        $this->openShift(training: true);
        $id = $this->sell(2500);

        $html = $this->actingAsUser($this->trainee)
            ->get("/api/v1/sales/{$id}/invoice")->assertOk()->getContent();

        $this->assertStringContainsString('Training', $html);
        $this->assertStringContainsString('not a real sale', strtolower($html));
    }

    // ── Helpers ─────────────────────────────────────────────────────

    private function openShift(bool $training = false, float $float = 1000): array
    {
        $session = $this->actingAsUser($this->trainee)
            ->postJson('/api/v1/pos/session/open', [
                'opening_float' => $float,
                'is_training' => $training,
            ])->assertCreated()->json('data');

        $this->sessionId = $session['id'];

        return $session;
    }

    private function closeShift(): void
    {
        $this->actingAsUser($this->trainee)
            ->postJson('/api/v1/pos/session/close', ['counted_cash' => 0])
            ->assertOk();

        $this->sessionId = null;
    }

    private function sell(float $amount, array $extra = []): string
    {
        return $this->actingAsUser($this->trainee)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'cash_session_id' => $this->sessionId,
            'items' => [['product_id' => $this->rice->id, 'quantity' => $amount / 2500]],
            'payment_method' => 'cash',
            'amount_paid' => $amount,
            ...$extra,
        ])->assertCreated()->json('data.id');
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** Guard against the fixture drifting: CashSession must expose the flag. */
    public function test_the_session_model_exposes_the_flag(): void
    {
        $this->openShift(training: true);

        $this->assertTrue(CashSession::withoutTenancy()->find($this->sessionId)->isTraining());
    }
}
