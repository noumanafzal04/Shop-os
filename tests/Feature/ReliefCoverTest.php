<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\CashSession;
use App\Models\CashSessionCover;
use App\Models\Product;
use App\Models\Register;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Somebody else stood at the till for ten minutes.
 *
 * Until now a shift was CASHIER × LANE and nothing else, so a break left three
 * bad options: stop the lane, count the drawer out for a ten-minute absence, or
 * let the reliever ring under the absent cashier's login. The counter picks the
 * third, and it makes every stamp on those sales a lie.
 *
 * The rule every test here defends: A COVER MOVES THE QUEUE, NOT THE DRAWER.
 *
 *   - the reliever SELLS, under their own name;
 *   - the cash still lands in the drawer they are standing at;
 *   - the cashier who opened the shift still counts it and still wears the
 *     variance — so the reliever can neither close it nor move money out of it.
 *
 * If cover granted reconciliation too it would just be a handover with extra
 * steps, and two people would be accountable for one box.
 */
class ReliefCoverTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    /** The cashier whose drawer it is. */
    private User $ayesha;

    /** The one who steps in. */
    private User $bilal;

    private Register $lane1;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create(['name' => 'Owner']);
        $this->ayesha = User::factory()->tenantStaff($this->tenant, ['sales.manage'])->create(['name' => 'Ayesha']);
        $this->bilal = User::factory()->tenantStaff($this->tenant, ['sales.manage'])->create(['name' => 'Bilal']);

        $main = Branch::withoutTenancy()
            ->where('tenant_id', $this->tenant->id)->where('is_default', true)->firstOrFail();
        $this->lane1 = Register::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $main->id, 'name' => 'Lane 1', 'is_active' => true,
        ]);

        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Cooking oil 1L', 'sku' => 'OIL-1L', 'price' => 500, 'cost' => 400,
            'stock_quantity' => 500, 'track_inventory' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** Ayesha opens Lane 1 and returns her shift id. */
    private function ayeshaOpensLane1(float $float = 3000): string
    {
        return $this->actingAsUser($this->ayesha)
            ->withHeader('X-Register-Id', $this->lane1->id)
            ->postJson('/api/v1/pos/session/open', [
                'opening_float' => $float, 'register_id' => $this->lane1->id,
            ])->assertCreated()->json('data.id');
    }

    private function startCover(?User $who = null): TestResponse
    {
        return $this->actingAsUser($who ?? $this->bilal)
            ->withHeader('X-Register-Id', $this->lane1->id)
            ->postJson('/api/v1/pos/session/cover', ['reason' => 'Prayer break']);
    }

    /** Ring a cash sale into $sessionId as $who. */
    private function sell(User $who, string $sessionId, int $qty = 1): array
    {
        return $this->actingAsUser($who)
            ->withHeader('X-Register-Id', $this->lane1->id)
            ->postJson('/api/v1/sales', [
                'channel' => 'pos', 'payment_method' => 'cash',
                'cash_session_id' => $sessionId,
                'items' => [['product_id' => $this->product->id, 'quantity' => $qty]],
                'amount_paid' => 500 * $qty,
            ])->assertCreated()->json('data');
    }

    // ── The thing itself ────────────────────────────────────────────

    /**
     * The whole point: the sale belongs to whoever rang it, the money belongs
     * to the drawer it went into, and those are two different people.
     */
    public function test_a_reliever_sells_under_their_own_name_into_the_cashiers_drawer(): void
    {
        $shift = $this->ayeshaOpensLane1();
        $this->startCover()->assertOk()->assertJsonPath('data.covering', true);

        $sale = $this->sell($this->bilal, $shift);

        $row = Sale::withoutTenancy()->findOrFail($sale['id']);
        $this->assertSame($this->bilal->id, $row->created_by, 'rung by Bilal');
        $this->assertSame($shift, $row->cash_session_id, 'into Ayesha\'s drawer');
    }

    /** The cashier's reconciliation has to include what the reliever took. */
    public function test_the_relievers_cash_is_expected_in_the_drawer_at_close(): void
    {
        $shift = $this->ayeshaOpensLane1(3000);
        $this->startCover()->assertOk();
        $this->sell($this->bilal, $shift, 2);   // 1000 in cash

        $drawer = $this->actingAsUser($this->ayesha)
            ->getJson('/api/v1/pos/session/report')->assertOk()->json('data.drawer');

        $this->assertEquals(4000, $drawer['expected_cash'], 'float 3000 + Bilal\'s 1000');
        $this->assertEquals(1, $drawer['sales_count']);
    }

    /** Without a cover, the original guard still stands. */
    public function test_ringing_on_someone_elses_drawer_without_a_cover_is_still_refused(): void
    {
        $shift = $this->ayeshaOpensLane1();

        $this->actingAsUser($this->bilal)
            ->postJson('/api/v1/sales', [
                'channel' => 'pos', 'payment_method' => 'cash',
                'cash_session_id' => $shift,
                'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
                'amount_paid' => 500,
            ])->assertStatus(422)->assertJsonValidationErrors('cash_session_id');
    }

    /** And the permission dies with the cover, not later. */
    public function test_a_reliever_cannot_ring_once_the_till_is_handed_back(): void
    {
        $shift = $this->ayeshaOpensLane1();
        $this->startCover()->assertOk();
        $this->actingAsUser($this->bilal)->postJson('/api/v1/pos/session/cover/end')->assertOk();

        $this->actingAsUser($this->bilal)
            ->postJson('/api/v1/sales', [
                'channel' => 'pos', 'payment_method' => 'cash',
                'cash_session_id' => $shift,
                'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
                'amount_paid' => 500,
            ])->assertStatus(422);
    }

    // ── Cover grants selling, never reconciling ─────────────────────

    public function test_a_reliever_cannot_close_the_drawer_they_are_covering(): void
    {
        $this->ayeshaOpensLane1();
        $this->startCover()->assertOk();

        $this->actingAsUser($this->bilal)
            ->postJson('/api/v1/pos/session/close', ['counted_cash' => 3000])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'COVERING_ANOTHER_DRAWER');
    }

    public function test_a_reliever_cannot_pay_money_out_of_a_drawer_they_will_never_count(): void
    {
        $this->ayeshaOpensLane1();
        $this->startCover()->assertOk();

        $this->actingAsUser($this->bilal)
            ->postJson('/api/v1/pos/session/movements', [
                'type' => 'paid_out', 'amount' => 500, 'reason' => 'Tea',
            ])
            ->assertStatus(403)
            ->assertJsonPath('meta.error_code', 'COVER_CANNOT_MOVE_CASH');
    }

    /** Opening the drawer to make change is the one thing they do need. */
    public function test_a_reliever_may_still_open_the_drawer(): void
    {
        $shift = $this->ayeshaOpensLane1();
        $this->startCover()->assertOk();

        $this->actingAsUser($this->bilal)
            ->postJson('/api/v1/pos/session/movements', ['type' => 'no_sale'])
            ->assertCreated();

        $this->assertDatabaseHas('cash_movements', [
            'cash_session_id' => $shift, 'user_id' => $this->bilal->id, 'type' => 'no_sale',
        ]);
    }

    // ── Who may cover ───────────────────────────────────────────────

    public function test_a_cashier_holding_their_own_drawer_cannot_cover_another(): void
    {
        $this->ayeshaOpensLane1();

        $lane2 = Register::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $this->lane1->branch_id,
            'name' => 'Lane 2', 'is_active' => true,
        ]);
        $this->actingAsUser($this->bilal)
            ->postJson('/api/v1/pos/session/open', ['opening_float' => 1000, 'register_id' => $lane2->id])
            ->assertCreated();

        $this->startCover()->assertStatus(409)->assertJsonPath('meta.error_code', 'ALREADY_ON_A_SHIFT');
    }

    public function test_you_cannot_cover_your_own_drawer(): void
    {
        $this->ayeshaOpensLane1();

        $this->startCover($this->ayesha)
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'CANNOT_COVER_OWN_SHIFT');
    }

    public function test_only_one_person_covers_at_a_time(): void
    {
        $this->ayeshaOpensLane1();
        $this->startCover($this->bilal)->assertOk();

        $this->startCover($this->owner)
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'ALREADY_COVERED');
    }

    /** A double-tap on a busy counter is not an error. */
    public function test_covering_twice_returns_the_same_cover(): void
    {
        $this->ayeshaOpensLane1();
        $first = $this->startCover()->assertOk()->json('data.id');
        $second = $this->startCover()->assertOk()->json('data.id');

        $this->assertSame($first, $second);
        $this->assertSame(1, CashSessionCover::withoutTenancy()->count());
    }

    public function test_there_is_nothing_to_cover_on_an_idle_lane(): void
    {
        $this->startCover()
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'SHIFT_NOT_OPEN');
    }

    // ── Ending it ───────────────────────────────────────────────────

    /**
     * The gesture the counter will actually make. A reliever who has to
     * remember to hand the till back will sometimes not, and the next sale
     * would carry the wrong name.
     */
    public function test_the_cashier_unlocking_with_their_pin_ends_the_cover(): void
    {
        $this->ayeshaOpensLane1();
        $this->startCover()->assertOk();
        $this->ayesha->setPin('4417');

        $this->actingAsUser($this->bilal)
            ->withHeader('X-Register-Id', $this->lane1->id)
            ->postJson('/api/v1/pos/unlock', ['user_id' => $this->ayesha->id, 'pin' => '4417'])
            ->assertOk()
            ->assertJsonPath('data.cover_ended', true);

        $this->assertNotNull(
            CashSessionCover::withoutTenancy()->firstOrFail()->ended_at,
            'the cover closed itself when Ayesha came back',
        );
    }

    /**
     * Frozen at hand-back, for the same reason a Z-read is frozen: "what did
     * the reliever take" is asked when the drawer is short, and an answer that
     * drifts as sales are voided later settles nothing.
     */
    public function test_the_relievers_figures_freeze_when_the_till_is_handed_back(): void
    {
        $shift = $this->ayeshaOpensLane1();
        $this->startCover()->assertOk();
        $sale = $this->sell($this->bilal, $shift, 2);   // 1000

        $this->actingAsUser($this->bilal)->postJson('/api/v1/pos/session/cover/end')->assertOk();

        $cover = CashSessionCover::withoutTenancy()->firstOrFail();
        $this->assertEquals(1, $cover->sales_count);
        $this->assertEquals(1000, $cover->sales_total);
        $this->assertEquals(1000, $cover->cash_taken);

        // Void it afterwards — the frozen record must not move.
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason_code' => 'wrong_item'])
            ->assertOk();

        $cover->refresh();
        $this->assertEquals(1, $cover->sales_count, 'still says what it said on the night');
        $this->assertEquals(1000, $cover->sales_total);
    }

    public function test_closing_the_shift_ends_a_cover_still_running(): void
    {
        $shift = $this->ayeshaOpensLane1();
        $this->startCover()->assertOk();
        $this->sell($this->bilal, $shift);

        $this->actingAsUser($this->ayesha)
            ->postJson('/api/v1/pos/session/close', ['counted_cash' => 3500])
            ->assertOk();

        $this->assertNotNull(CashSessionCover::withoutTenancy()->firstOrFail()->ended_at);
        $this->assertSame('closed', CashSession::withoutTenancy()->findOrFail($shift)->status);
    }

    public function test_ending_a_cover_when_none_is_running_says_so(): void
    {
        $this->ayeshaOpensLane1();

        $this->actingAsUser($this->bilal)
            ->postJson('/api/v1/pos/session/cover/end')
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'NOT_COVERING');
    }

    // ── What the reports say ────────────────────────────────────────

    /**
     * Without this a variance is one undifferentiated number covering a stretch
     * the cashier was not even standing there for.
     */
    public function test_the_x_read_names_who_covered_and_what_they_took(): void
    {
        $shift = $this->ayeshaOpensLane1();
        $this->startCover()->assertOk();
        $this->sell($this->bilal, $shift, 3);   // 1500

        $covers = $this->actingAsUser($this->ayesha)
            ->getJson('/api/v1/pos/session/report')->assertOk()->json('data.covers');

        $this->assertCount(1, $covers);
        $this->assertSame('Bilal', $covers[0]['user_name']);
        $this->assertTrue($covers[0]['open'], 'still standing there');
        $this->assertEquals(1500, $covers[0]['cash_taken']);
        $this->assertSame('Prayer break', $covers[0]['reason']);
    }

    public function test_the_z_read_keeps_the_cover_on_the_permanent_record(): void
    {
        $shift = $this->ayeshaOpensLane1();
        $this->startCover()->assertOk();
        $this->sell($this->bilal, $shift, 2);
        $this->actingAsUser($this->bilal)->postJson('/api/v1/pos/session/cover/end')->assertOk();
        $this->actingAsUser($this->ayesha)
            ->postJson('/api/v1/pos/session/close', ['counted_cash' => 4000])->assertOk();

        $covers = $this->actingAsUser($this->ayesha)
            ->getJson("/api/v1/pos/sessions/{$shift}/z-report")->assertOk()->json('data.covers');

        $this->assertCount(1, $covers);
        $this->assertSame('Bilal', $covers[0]['user_name']);
        $this->assertFalse($covers[0]['open']);
        $this->assertEquals(1000, $covers[0]['cash_taken']);
    }

    /**
     * A reliever asking what shift they are on gets the id they must quote on
     * every sale and whose drawer it is — and none of the numbers the cashier
     * will be measured against.
     */
    public function test_a_reliever_is_told_what_they_are_holding_but_not_what_it_contains(): void
    {
        $this->ayeshaOpensLane1();
        $this->startCover()->assertOk();

        $data = $this->actingAsUser($this->bilal)
            ->getJson('/api/v1/pos/session')->assertOk()->json('data');

        $this->assertTrue($data['covering']);
        $this->assertSame('Ayesha', $data['cashier_name']);
        $this->assertArrayNotHasKey('opening_float', $data);
        $this->assertArrayNotHasKey('expected_cash', $data);
    }

    /** And the cashier is told somebody is standing at their drawer. */
    public function test_the_cashier_sees_who_is_covering_them(): void
    {
        $this->ayeshaOpensLane1();
        $this->startCover()->assertOk();

        $this->actingAsUser($this->ayesha)
            ->getJson('/api/v1/pos/session')->assertOk()
            ->assertJsonPath('data.covered_by.user_name', 'Bilal');
    }

    public function test_covering_rides_the_pos_module(): void
    {
        $this->ayeshaOpensLane1();

        $this->tenant->forceFill([
            'features' => array_merge(BusinessTypes::defaultFeatures('mart'), ['pos' => false]),
        ])->save();

        $this->startCover()
            ->assertForbidden()
            ->assertJsonPath('meta.error_code', 'MODULE_DISABLED');
    }
}
