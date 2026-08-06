<?php

namespace Tests\Feature;

use App\Models\CashSession;
use App\Models\City;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\CashRounding;
use App\Support\DrawerMath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Settling a cash bill to a coin that exists.
 *
 * Sub-rupee coins do not circulate here and many counters cannot break a five,
 * so a bill of Rs 1,247.63 has no exact cash tender. Before this, the till
 * demanded the exact figure and produced change nobody could hand over; the
 * difference went into the DRAWER VARIANCE, a few paisa at a time, on every
 * cash sale. Over a month a real Rs 200 shortage is invisible inside the noise
 * — which defeats the one number a shift exists to produce.
 *
 * Two invariants carry the whole feature, and both are asserted here:
 *
 *   `total` NEVER MOVES. Tax is computed on it. A settlement convenience that
 *   shifts a tax figure is a different and much worse bug than the one it set
 *   out to fix.
 *
 *   THE DRAWER STILL RECONCILES EXACTLY. DrawerMath reads what was tendered
 *   minus what was handed back, so if rounding lives in "what is due" the
 *   expected cash follows for free — and the variance on a perfectly counted
 *   drawer is zero, not 37 paisa.
 */
class CashRoundingTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        // 247.63 a unit — an honest awkward price, not a contrived one.
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Cooking oil 1L', 'sku' => 'OIL-1L',
            'price' => 247.63, 'cost' => 200, 'stock_quantity' => 500, 'track_inventory' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function roundsTo(int $increment): void
    {
        $this->tenant->forceFill([
            'settings' => array_merge($this->tenant->settings ?? [], ['cash_rounding' => $increment]),
        ])->save();
    }

    /** @param  array<string, mixed>  $overrides */
    private function ring(array $overrides = []): TestResponse
    {
        return $this->actingAsUser($this->owner)->postJson('/api/v1/sales', array_merge([
            'channel' => 'walk_in',
            'payment_method' => 'cash',
            'amount_paid' => 5000,
            'items' => [['product_id' => $this->product->id, 'quantity' => 5]],
        ], $overrides));
    }

    // ── The arithmetic, on its own ──────────────────────────────────

    public function test_rounds_to_the_nearest_increment_with_ties_going_to_the_customer(): void
    {
        $this->assertEquals(1247.63, CashRounding::apply(1247.63, 0), 'off means exact');

        $this->assertEquals(1248.0, CashRounding::apply(1247.63, 1));
        $this->assertEquals(1247.0, CashRounding::apply(1247.40, 1));

        $this->assertEquals(1250.0, CashRounding::apply(1247.63, 5));
        $this->assertEquals(1245.0, CashRounding::apply(1246.00, 5));
        // A tie goes DOWN — a shop that surprises people upward gets asked.
        $this->assertEquals(1245.0, CashRounding::apply(1247.50, 5));

        $this->assertEquals(1250.0, CashRounding::apply(1247.63, 10));
        $this->assertEquals(1240.0, CashRounding::apply(1244.99, 10));
        $this->assertEquals(1240.0, CashRounding::apply(1245.00, 10), 'tie at ten also goes down');
    }

    public function test_only_a_wholly_cash_settlement_rounds(): void
    {
        $this->assertTrue(CashRounding::settlesInCashOnly(['cash']));
        $this->assertTrue(CashRounding::settlesInCashOnly(['cash', 'cash']));

        // A card terminal takes the exact figure; a khata balance is a number
        // in a ledger, not coins in a hand.
        $this->assertFalse(CashRounding::settlesInCashOnly(['cash', 'card']));
        $this->assertFalse(CashRounding::settlesInCashOnly(['card']));
        $this->assertFalse(CashRounding::settlesInCashOnly(['cash', 'credit']));
        $this->assertFalse(CashRounding::settlesInCashOnly(['cash', 'trade_in']));
        // Nothing tendered is not a cash sale.
        $this->assertFalse(CashRounding::settlesInCashOnly([]));
    }

    // ── At the till ─────────────────────────────────────────────────

    public function test_a_cash_bill_settles_to_the_shops_increment(): void
    {
        $this->roundsTo(5);

        // 5 × 247.63 = 1,238.15 → 1,240 at five-rupee rounding.
        $sale = $this->ring()->assertCreated()->json('data');

        $this->assertEquals(1238.15, $sale['total'], 'the bill itself must not move');
        $this->assertEquals(1.85, $sale['rounding_adjustment']);
        // Handed over 5,000, owed 1,240 → 3,760 back.
        $this->assertEquals(3760, $sale['change_due']);
    }

    public function test_rounding_never_touches_the_taxed_total(): void
    {
        $this->tenant->forceFill([
            'settings' => array_merge($this->tenant->settings ?? [], [
                'cash_rounding' => 10, 'default_tax_rate' => 17,
            ]),
        ])->save();

        $sale = $this->ring()->assertCreated()->json('data');

        // Tax is 17% of 1,238.15 = 210.49, total 1,448.64 — computed before
        // rounding and unmoved by it. If this ever fails, a settlement rule has
        // started rewriting a tax figure.
        $this->assertEquals(210.49, $sale['tax']);
        $this->assertEquals(1448.64, $sale['total']);
        $this->assertEquals(1.36, $sale['rounding_adjustment'], 'settles at 1,450');
    }

    public function test_a_card_sale_is_never_rounded(): void
    {
        $this->roundsTo(5);

        $sale = $this->ring(['payment_method' => 'card', 'amount_paid' => 1238.15])
            ->assertCreated()->json('data');

        $this->assertEquals(0, $sale['rounding_adjustment']);
        $this->assertEquals(1238.15, $sale['total']);
    }

    public function test_a_split_that_includes_a_card_is_never_rounded(): void
    {
        $this->roundsTo(5);

        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'payments' => [
                ['method' => 'cash', 'amount' => 1000],
                ['method' => 'card', 'amount' => 238.15],
            ],
            'items' => [['product_id' => $this->product->id, 'quantity' => 5]],
        ])->assertCreated()->json('data');

        $this->assertEquals(0, $sale['rounding_adjustment']);
    }

    public function test_a_shop_with_rounding_off_still_settles_to_the_paisa(): void
    {
        $sale = $this->ring()->assertCreated()->json('data');

        $this->assertEquals(0, $sale['rounding_adjustment']);
        $this->assertEquals(1238.15, $sale['total']);
        $this->assertEquals(3761.85, $sale['change_due']);
    }

    /**
     * The rounded figure is what must be covered — not the exact one. A cashier
     * handed 1,240 for a 1,238.15 bill has been paid in full.
     */
    public function test_the_rounded_amount_is_what_the_payment_is_checked_against(): void
    {
        $this->roundsTo(5);

        $this->ring(['amount_paid' => 1240])->assertCreated();

        // And a rupee short of the rounded figure is still short.
        $this->ring(['amount_paid' => 1239])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'PAYMENT_INSUFFICIENT');
    }

    /** Rounding UP costs the customer; that direction has to work too. */
    public function test_rounding_can_collect_the_difference_as_well_as_give_it_up(): void
    {
        $this->roundsTo(5);

        // 3 × 247.63 = 742.89 → 745. The shop collects 2.11.
        $sale = $this->ring([
            'items' => [['product_id' => $this->product->id, 'quantity' => 3]],
        ])->assertCreated()->json('data');

        $this->assertEquals(742.89, $sale['total']);
        $this->assertEquals(2.11, $sale['rounding_adjustment']);
    }

    // ── The drawer, which is the entire point ───────────────────────

    /**
     * A perfectly counted drawer must show ZERO variance. This is the bug the
     * feature exists to fix: without rounding the shift expected 1,238.15 in a
     * till that physically held 1,240, and reported the difference as an
     * overage the cashier was asked to explain.
     */
    public function test_a_counted_drawer_reconciles_to_zero_after_a_rounded_sale(): void
    {
        $this->roundsTo(5);

        $session = $this->actingAsUser($this->owner)
            ->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])
            ->assertSuccessful()->json('data');

        // Customer hands over exactly the rounded figure — no change.
        $this->ring(['amount_paid' => 1240, 'cash_session_id' => $session['id']])->assertCreated();

        $drawer = DrawerMath::for(CashSession::withoutTenancy()->findOrFail($session['id']));

        $this->assertEquals(1240, $drawer['cash_sales']);
        $this->assertEquals(2240, $drawer['expected_cash'], '1,000 float + 1,240 taken');

        $close = $this->actingAsUser($this->owner)
            ->postJson('/api/v1/pos/session/close', ['counted_cash' => 2240])
            ->assertSuccessful()->json('data');

        $this->assertEquals(0, $close['variance'], 'a correctly counted drawer is never short');
    }

    /** Change given back is measured from the rounded figure, not the bill. */
    public function test_change_leaves_the_drawer_against_the_rounded_figure(): void
    {
        $this->roundsTo(10);

        $session = $this->actingAsUser($this->owner)
            ->postJson('/api/v1/pos/session/open', ['opening_float' => 500])
            ->assertSuccessful()->json('data');

        // 1,238.15 → 1,240 at ten-rupee rounding. Handed 2,000 → 760 back.
        $sale = $this->ring(['amount_paid' => 2000, 'cash_session_id' => $session['id']])
            ->assertCreated()->json('data');
        $this->assertEquals(760, $sale['change_due']);

        $drawer = DrawerMath::for(CashSession::withoutTenancy()->findOrFail($session['id']));

        // 2,000 in, 760 out — the till holds 1,240 of takings, a figure that
        // can actually be counted in notes.
        $this->assertEquals(1240, $drawer['cash_sales']);
        $this->assertEquals(1740, $drawer['expected_cash']);
    }

    /**
     * The adjustment is stored so a month of them can be added back up. A shop
     * rounding down on every bill is giving away real money, and it is entitled
     * to know how much.
     */
    public function test_the_adjustment_is_recorded_on_the_sale_for_reporting(): void
    {
        $this->roundsTo(5);
        $this->ring()->assertCreated();
        $this->ring()->assertCreated();

        $this->assertEquals(
            3.70,
            round((float) Sale::withoutTenancy()->sum('rounding_adjustment'), 2),
            'two bills that each gave up 1.85',
        );
    }
}
