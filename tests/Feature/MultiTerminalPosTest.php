<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\CashSession;
use App\Models\HardwareDevice;
use App\Models\HeldSale;
use App\Models\Plan;
use App\Models\Product;
use App\Models\Register;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Multi-terminal POS — the large-mart case: six checkout lanes, a cashier at
 * each, one shop.
 *
 * What this suite pins down:
 *   - a shift is CASHIER × TERMINAL, so lanes run independently and each drawer
 *     reconciles only its own cash;
 *   - the lane a cashier already holds is resumable, not a lockout;
 *   - a lane can never be double-claimed, even under a race;
 *   - hardware binds per lane (lane 2's printer is not lane 5's);
 *   - a parked ticket belongs to the SITE, so any lane can finish it;
 *   - a manager can free a lane a cashier abandoned.
 *
 * A shop with no registers at all must behave exactly as it did before —
 * that's the last test in the shifts section.
 */
class MultiTerminalPosTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private User $cashierA;

    private User $cashierB;

    private Branch $main;

    private Register $lane1;

    private Register $lane2;

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
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->cashierA = User::factory()->tenantStaff($this->tenant, ['sales.void', 'sales.refund', 'sales.manage'])->create(['name' => 'Ayesha']);
        $this->cashierB = User::factory()->tenantStaff($this->tenant, ['sales.void', 'sales.refund', 'sales.manage'])->create(['name' => 'Bilal']);

        $this->main = Branch::withoutTenancy()
            ->where('tenant_id', $this->tenant->id)->where('is_default', true)->firstOrFail();

        $this->lane1 = $this->makeRegister('Lane 1', $this->main);
        $this->lane2 = $this->makeRegister('Lane 2', $this->main);

        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Cooking oil 1L', 'sku' => 'OIL-1L', 'price' => 500, 'cost' => 400,
            'stock_quantity' => 200, 'track_inventory' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function makeRegister(string $name, ?Branch $branch = null, bool $active = true): Register
    {
        return Register::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            'branch_id' => $branch?->id,
            'name' => $name,
            'is_active' => $active,
        ]);
    }

    /** Opens a shift for a cashier at a lane (the normal POS call). */
    private function openShift(User $user, ?Register $register, float $float = 1000): \Illuminate\Testing\TestResponse
    {
        return $this->actingAsUser($user)->postJson('/api/v1/pos/session/open', array_filter([
            'opening_float' => $float,
            'register_id' => $register?->id,
        ], fn ($v) => $v !== null));
    }

    /** Rings a cash sale on a given shift. */
    private function ringSale(User $user, string $sessionId, int $qty = 1): array
    {
        return $this->actingAsUser($user)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'cash_session_id' => $sessionId,
            'payment_method' => 'cash',
            'items' => [['product_id' => $this->product->id, 'quantity' => $qty]],
            'amount_paid' => 500 * $qty,
        ])->assertCreated()->json('data');
    }

    // ── Configuring the lanes ───────────────────────────────────────

    public function test_owner_can_add_a_register_and_it_lands_on_the_operating_branch(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/registers', [
            'name' => 'Lane 3', 'code' => 'L3',
        ])->assertCreated()
            ->assertJsonPath('data.name', 'Lane 3')
            ->assertJsonPath('data.branch_id', $this->main->id);
    }

    public function test_two_lanes_at_one_branch_cannot_share_a_name(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/registers', ['name' => 'Lane 1'])
            ->assertStatus(422)->assertJsonStructure(['errors' => ['name']]);
    }

    /** Different sites, same lane naming — every mart calls its first lane "Lane 1". */
    public function test_the_same_lane_name_is_fine_at_another_branch(): void
    {
        $second = Branch::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Gulberg', 'is_default' => false, 'is_active' => true,
        ]);

        $this->actingAsUser($this->owner)->postJson('/api/v1/registers', [
            'name' => 'Lane 1', 'branch_id' => $second->id,
        ])->assertCreated();
    }

    /** A retired lane's name is free again — shops renumber every few years. */
    public function test_a_removed_lanes_name_can_be_reused(): void
    {
        $this->actingAsUser($this->owner)->deleteJson("/api/v1/registers/{$this->lane1->id}")->assertOk();

        $this->actingAsUser($this->owner)->postJson('/api/v1/registers', ['name' => 'Lane 1'])
            ->assertCreated();
    }

    public function test_a_cashier_cannot_configure_registers(): void
    {
        $this->actingAsUser($this->cashierA)->postJson('/api/v1/registers', ['name' => 'Rogue lane'])
            ->assertStatus(403);
    }

    /** A lane's shifts, sales and hardware are all where it physically stands. */
    public function test_a_register_cannot_be_moved_to_another_branch(): void
    {
        $second = Branch::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Gulberg', 'is_default' => false, 'is_active' => true,
        ]);

        $this->actingAsUser($this->owner)->putJson("/api/v1/registers/{$this->lane1->id}", [
            'branch_id' => $second->id,
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['branch_id']]);
    }

    public function test_registers_are_gated_by_the_pos_module(): void
    {
        $onlineOnly = Tenant::factory()->create([
            'setup_completed' => true,
            'business_type' => 'retail',
            'features' => ['pos' => false, 'products' => true, 'marketplace' => true],
        ]);
        $owner = User::factory()->shopOwner($onlineOnly)->create();

        $this->actingAsUser($owner)->getJson('/api/v1/registers')
            ->assertStatus(403)->assertJsonPath('meta.error_code', 'MODULE_DISABLED');
    }

    public function test_adding_a_register_respects_the_plan_limit(): void
    {
        $plan = Plan::query()->create([
            'code' => 'two-lanes', 'name' => 'Two lanes', 'price' => 0,
            'billing_period_months' => 1, 'online_shop_enabled' => false, 'grace_period_days' => 7,
            'features' => ['pos' => true], 'max_registers' => 2, 'is_active' => true,
        ]);
        $this->tenant->forceFill(['plan_id' => $plan->id])->save();

        // Two lanes already exist, so the third is over the line.
        $this->actingAsUser($this->owner)->postJson('/api/v1/registers', ['name' => 'Lane 3'])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'LIMIT_REACHED');

        // Extending this one tenant (not a new plan) unlocks it.
        $this->tenant->forceFill(['limit_overrides' => ['registers' => 6]])->save();
        $this->actingAsUser($this->owner)->postJson('/api/v1/registers', ['name' => 'Lane 3'])
            ->assertCreated();
    }

    public function test_a_lane_with_an_open_shift_cannot_be_removed_or_deactivated(): void
    {
        $this->openShift($this->cashierA, $this->lane1)->assertCreated();

        $this->actingAsUser($this->owner)->deleteJson("/api/v1/registers/{$this->lane1->id}")
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'REGISTER_IN_USE');

        $this->actingAsUser($this->owner)->putJson("/api/v1/registers/{$this->lane1->id}", ['is_active' => false])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'REGISTER_IN_USE');
    }

    /** The printer is still on the counter when the lane is retired. */
    public function test_removing_a_lane_returns_its_hardware_to_the_shared_pool(): void
    {
        $printer = HardwareDevice::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'register_id' => $this->lane1->id,
            'type' => 'receipt_printer', 'name' => 'Lane 1 printer',
            'connection_type' => 'browser', 'is_default' => true, 'is_active' => true,
        ]);

        $this->actingAsUser($this->owner)->deleteJson("/api/v1/registers/{$this->lane1->id}")->assertOk();

        $this->assertNull($printer->fresh()->register_id);
    }

    // ── Shifts: cashier × terminal ──────────────────────────────────

    /** The whole point of the unit: a mart runs several lanes at once. */
    public function test_two_cashiers_can_hold_shifts_on_two_lanes_at_once(): void
    {
        $a = $this->openShift($this->cashierA, $this->lane1)->assertCreated()->json('data');
        $b = $this->openShift($this->cashierB, $this->lane2)->assertCreated()->json('data');

        $this->assertNotSame($a['id'], $b['id']);
        $this->assertSame($this->lane1->id, $a['register_id']);
        $this->assertSame($this->lane2->id, $b['register_id']);
        $this->assertSame(2, CashSession::withoutTenancy()->where('status', 'open')->count());
    }

    /** One drawer, one cashier — two people counting the same box is a variance. */
    public function test_a_second_cashier_cannot_open_the_same_lane(): void
    {
        $this->openShift($this->cashierA, $this->lane1)->assertCreated();

        $this->openShift($this->cashierB, $this->lane1)
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'REGISTER_BUSY')
            // The message must name who is on it, or the manager has to go look.
            ->assertJsonFragment(['message' => 'Lane 1 already has an open shift (Ayesha). Close that shift, or use another register.']);
    }

    /**
     * The lockout this unit exists to fix: a browser refresh, a dead tablet or a
     * re-login used to leave the shift open and the cashier stuck outside it.
     */
    public function test_reopening_your_own_lane_resumes_the_shift_instead_of_erroring(): void
    {
        $first = $this->openShift($this->cashierA, $this->lane1, 1500)->assertCreated()->json('data');

        $again = $this->openShift($this->cashierA, $this->lane1, 9999)
            ->assertOk()          // resumed, not created
            ->json('data');

        $this->assertSame($first['id'], $again['id']);
        // The float is the morning's count — a resume must not overwrite it.
        $this->assertEquals(1500, $again['opening_float']);
        $this->assertSame(1, CashSession::withoutTenancy()->where('status', 'open')->count());
    }

    public function test_holding_a_shift_on_another_lane_is_a_named_conflict(): void
    {
        $this->openShift($this->cashierA, $this->lane1)->assertCreated();

        $this->openShift($this->cashierA, $this->lane2)
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'SHIFT_OPEN_ELSEWHERE')
            ->assertJsonFragment(['message' => 'You already have an open shift on Lane 1. Close it there, or move it to this register.']);
    }

    /** Shops adopt lanes mid-life; a shift already running just picks one up. */
    public function test_a_lane_less_shift_adopts_the_terminal_it_reopens_on(): void
    {
        $legacy = CashSession::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $this->main->id, 'register_id' => null,
            'user_id' => $this->cashierA->id, 'status' => 'open', 'opening_float' => 700, 'opened_at' => now(),
        ]);

        $resumed = $this->openShift($this->cashierA, $this->lane2)->assertOk()->json('data');

        $this->assertSame($legacy->id, $resumed['id']);
        $this->assertSame($this->lane2->id, $resumed['register_id']);
    }

    /** A shop that never creates a lane keeps the exact old behaviour. */
    public function test_a_shop_without_lanes_still_rejects_a_second_shift(): void
    {
        $this->openShift($this->cashierA, null)->assertCreated();

        $this->openShift($this->cashierA, null)
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'SHIFT_ALREADY_OPEN');
    }

    // ── The terminal header ─────────────────────────────────────────

    public function test_the_terminal_header_selects_the_lane_without_naming_it_in_the_body(): void
    {
        $session = $this->actingAsUser($this->cashierA)
            ->withHeader('X-Register-Id', $this->lane2->id)
            ->postJson('/api/v1/pos/session/open', ['opening_float' => 500])
            ->assertCreated()->json('data');

        $this->assertSame($this->lane2->id, $session['register_id']);
    }

    /** A header must never point a sale (and its stock) at another site. */
    public function test_a_header_naming_another_branchs_lane_is_ignored(): void
    {
        $second = Branch::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Gulberg', 'is_default' => false, 'is_active' => true,
        ]);
        $foreign = $this->makeRegister('Lane 1', $second);

        // cashierA is pinned to no branch → resolves to Main; the header points
        // at Gulberg's lane, which is not this terminal.
        $session = $this->actingAsUser($this->cashierA)
            ->withHeader('X-Register-Id', $foreign->id)
            ->postJson('/api/v1/pos/session/open', ['opening_float' => 500])
            ->assertCreated()->json('data');

        $this->assertNull($session['register_id']);
    }

    /** A device carrying a deleted lane's id must not lock the cashier out. */
    public function test_a_stale_terminal_header_does_not_block_opening_a_shift(): void
    {
        $gone = $this->makeRegister('Lane 9', $this->main);
        $gone->delete();

        $this->actingAsUser($this->cashierA)
            ->withHeader('X-Register-Id', $gone->id)
            ->postJson('/api/v1/pos/session/open', ['opening_float' => 500])
            ->assertCreated();
    }

    /** After a refresh the lane is remembered from the open shift itself. */
    public function test_the_terminal_falls_back_to_the_lane_of_your_open_shift(): void
    {
        $this->openShift($this->cashierA, $this->lane2)->assertCreated();

        $this->actingAsUser($this->cashierA)->getJson('/api/v1/pos/terminal')
            ->assertOk()->assertJsonPath('data.register.id', $this->lane2->id);
    }

    // ── Handover ────────────────────────────────────────────────────

    /**
     * A lane's terminal dies mid-rush. Closing and re-opening would split one
     * physical drawer across two counts and invent a variance in both, so the
     * shift moves intact.
     */
    public function test_a_cashier_can_carry_an_open_drawer_to_another_lane(): void
    {
        $session = $this->openShift($this->cashierA, $this->lane1, 1000)->assertCreated()->json('data');
        $this->ringSale($this->cashierA, $session['id']);

        $moved = $this->actingAsUser($this->cashierA)
            ->postJson('/api/v1/pos/session/move', ['register_id' => $this->lane2->id])
            ->assertOk()->json('data');

        $this->assertSame($session['id'], $moved['id']);      // same drawer
        $this->assertSame($this->lane2->id, $moved['register_id']);

        // …and the close still counts that one drawer once: 1000 float + 500 cash.
        $closed = $this->actingAsUser($this->cashierA)
            ->postJson('/api/v1/pos/session/close', ['counted_cash' => 1500])
            ->assertOk()->json('data');

        $this->assertEquals(1500, $closed['expected_cash']);
        $this->assertEquals(0, $closed['variance']);
    }

    public function test_a_shift_cannot_be_moved_onto_an_occupied_lane(): void
    {
        $this->openShift($this->cashierA, $this->lane1)->assertCreated();
        $this->openShift($this->cashierB, $this->lane2)->assertCreated();

        $this->actingAsUser($this->cashierA)
            ->postJson('/api/v1/pos/session/move', ['register_id' => $this->lane2->id])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'REGISTER_BUSY');
    }

    public function test_moving_without_an_open_shift_is_refused(): void
    {
        $this->actingAsUser($this->cashierA)
            ->postJson('/api/v1/pos/session/move', ['register_id' => $this->lane1->id])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'SHIFT_NOT_OPEN');
    }

    public function test_a_shift_cannot_move_onto_a_retired_lane(): void
    {
        $this->openShift($this->cashierA, $this->lane1)->assertCreated();
        $this->lane2->forceFill(['is_active' => false])->save();

        $this->actingAsUser($this->cashierA)
            ->postJson('/api/v1/pos/session/move', ['register_id' => $this->lane2->id])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'REGISTER_NOT_FOUND');
    }

    // ── Money stays on its own lane ─────────────────────────────────

    public function test_a_sale_is_stamped_with_the_lane_that_rang_it(): void
    {
        $session = $this->openShift($this->cashierA, $this->lane2)->assertCreated()->json('data');
        $sale = $this->ringSale($this->cashierA, $session['id']);

        $this->assertSame($this->lane2->id, Sale::withoutTenancy()->find($sale['id'])->register_id);
    }

    /**
     * The reconciliation test: two lanes trading at once, each drawer must
     * expect only its own cash. A shared count is how a mart loses money it
     * cannot trace.
     */
    public function test_each_lanes_drawer_reconciles_only_its_own_cash(): void
    {
        $a = $this->openShift($this->cashierA, $this->lane1, 1000)->assertCreated()->json('data');
        $b = $this->openShift($this->cashierB, $this->lane2, 2000)->assertCreated()->json('data');

        $this->ringSale($this->cashierA, $a['id']);          // 500 into lane 1
        $this->ringSale($this->cashierB, $b['id'], 3);       // 1500 into lane 2
        $this->ringSale($this->cashierB, $b['id']);          //  500 into lane 2

        $closedA = $this->actingAsUser($this->cashierA)
            ->postJson('/api/v1/pos/session/close', ['counted_cash' => 1500])->assertOk()->json('data');
        $closedB = $this->actingAsUser($this->cashierB)
            ->postJson('/api/v1/pos/session/close', ['counted_cash' => 4000])->assertOk()->json('data');

        $this->assertEquals(500, $closedA['cash_sales']);
        $this->assertEquals(1500, $closedA['expected_cash']);
        $this->assertEquals(0, $closedA['variance']);
        $this->assertEquals(1, $closedA['sales_count']);

        $this->assertEquals(2000, $closedB['cash_sales']);
        $this->assertEquals(4000, $closedB['expected_cash']);
        $this->assertEquals(0, $closedB['variance']);
        $this->assertEquals(2, $closedB['sales_count']);
    }

    /** Closing a lane frees it for the next cashier — the shift-change case. */
    public function test_closing_a_lane_frees_it_for_the_next_cashier(): void
    {
        $this->openShift($this->cashierA, $this->lane1)->assertCreated();
        $this->actingAsUser($this->cashierA)
            ->postJson('/api/v1/pos/session/close', ['counted_cash' => 1000])->assertOk();

        $this->openShift($this->cashierB, $this->lane1)->assertCreated();
    }

    // ── Manager: free a lane, see the whole day ─────────────────────

    /** A cashier who leaves without counting out must not idle a checkout. */
    public function test_a_manager_can_force_close_an_abandoned_lane(): void
    {
        $session = $this->openShift($this->cashierA, $this->lane1, 1000)->assertCreated()->json('data');
        $this->ringSale($this->cashierA, $session['id']);

        $closed = $this->actingAsUser($this->owner)
            ->postJson("/api/v1/pos/registers/{$this->lane1->id}/close", [
                'counted_cash' => 1400, 'notes' => 'Cashier left without closing',
            ])->assertOk()->json('data');

        $this->assertSame('closed', $closed['status']);
        $this->assertEquals(1500, $closed['expected_cash']);
        $this->assertEquals(-100, $closed['variance']);       // 100 short
        // Who ended it is recorded — this is not the cashier's own count.
        $this->assertSame($this->owner->id, $closed['closed_by']);

        // The lane is free again.
        $this->openShift($this->cashierB, $this->lane1)->assertCreated();
    }

    public function test_a_cashier_cannot_force_close_another_lane(): void
    {
        $this->openShift($this->cashierA, $this->lane1)->assertCreated();

        $this->actingAsUser($this->cashierB)
            ->postJson("/api/v1/pos/registers/{$this->lane1->id}/close", ['counted_cash' => 0])
            ->assertStatus(403);
    }

    public function test_force_closing_a_lane_with_no_shift_is_refused(): void
    {
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/pos/registers/{$this->lane2->id}/close", ['counted_cash' => 0])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'SHIFT_NOT_OPEN');
    }

    /** The consolidated close: every lane's drawer on one screen. */
    public function test_the_day_view_totals_every_lane(): void
    {
        $a = $this->openShift($this->cashierA, $this->lane1, 1000)->assertCreated()->json('data');
        $b = $this->openShift($this->cashierB, $this->lane2, 2000)->assertCreated()->json('data');
        $this->ringSale($this->cashierA, $a['id']);
        $this->ringSale($this->cashierB, $b['id']);
        $this->actingAsUser($this->cashierA)->postJson('/api/v1/pos/session/close', ['counted_cash' => 1500])->assertOk();

        $day = $this->actingAsUser($this->owner)->getJson('/api/v1/pos/sessions')->assertOk()->json('data');

        $this->assertSame(2, $day['totals']['shifts']);
        $this->assertSame(1, $day['totals']['open']);         // lane 2 still trading
        $this->assertEquals(3000, $day['totals']['opening_float']);
        $this->assertEquals(500, $day['totals']['cash_sales']); // only the closed lane has computed cash
        $this->assertCount(2, $day['sessions']);
    }

    public function test_a_cashier_cannot_read_the_day_view(): void
    {
        $this->actingAsUser($this->cashierA)->getJson('/api/v1/pos/sessions')->assertStatus(403);
    }

    // ── Hardware binds to the lane ──────────────────────────────────

    /**
     * The bug this unit fixes: marking lane 2's printer default used to clear
     * the flag tenant-wide, so every lane printed to one machine.
     */
    public function test_each_lane_keeps_its_own_default_printer(): void
    {
        $p1 = $this->actingAsUser($this->owner)->postJson('/api/v1/hardware-devices', [
            'type' => 'receipt_printer', 'name' => 'Lane 1 printer', 'connection_type' => 'browser',
            'register_id' => $this->lane1->id, 'is_default' => true,
        ])->assertCreated()->json('data');

        $p2 = $this->actingAsUser($this->owner)->postJson('/api/v1/hardware-devices', [
            'type' => 'receipt_printer', 'name' => 'Lane 2 printer', 'connection_type' => 'browser',
            'register_id' => $this->lane2->id, 'is_default' => true,
        ])->assertCreated()->json('data');

        $this->assertTrue(HardwareDevice::withoutTenancy()->find($p1['id'])->is_default);
        $this->assertTrue(HardwareDevice::withoutTenancy()->find($p2['id'])->is_default);
    }

    /** Shop-wide devices are still their own single-default group. */
    public function test_shop_wide_defaults_still_collapse_to_one(): void
    {
        $old = $this->actingAsUser($this->owner)->postJson('/api/v1/hardware-devices', [
            'type' => 'receipt_printer', 'name' => 'Back office', 'connection_type' => 'browser', 'is_default' => true,
        ])->assertCreated()->json('data');

        $this->actingAsUser($this->owner)->postJson('/api/v1/hardware-devices', [
            'type' => 'receipt_printer', 'name' => 'Counter', 'connection_type' => 'browser', 'is_default' => true,
        ])->assertCreated();

        $this->assertFalse(HardwareDevice::withoutTenancy()->find($old['id'])->is_default);
    }

    /** Resolution walks outward: this lane's device, then the shared one. */
    public function test_a_lane_uses_its_own_device_and_falls_back_to_the_shared_one(): void
    {
        $shared = HardwareDevice::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'receipt_printer', 'name' => 'Shop printer',
            'connection_type' => 'browser', 'is_default' => true, 'is_active' => true,
        ]);
        $laneOwn = HardwareDevice::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'register_id' => $this->lane1->id,
            'type' => 'receipt_printer', 'name' => 'Lane 1 printer',
            'connection_type' => 'browser', 'is_default' => true, 'is_active' => true,
        ]);
        // A drawer only the shop has — lane 1 must still find it.
        HardwareDevice::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'cash_drawer', 'name' => 'Shared drawer',
            'connection_type' => 'browser', 'is_default' => true, 'is_active' => true,
        ]);

        app(\App\Support\TenantContext::class)->set($this->tenant);

        $atLane1 = HardwareDevice::resolveForRegister($this->lane1->id);
        $this->assertSame($laneOwn->id, $atLane1['receipt_printer']->id);
        $this->assertSame('Shared drawer', $atLane1['cash_drawer']->name);

        $atLane2 = HardwareDevice::resolveForRegister($this->lane2->id);
        $this->assertSame($shared->id, $atLane2['receipt_printer']->id);
    }

    /** An unplugged lane printer must fall through, not swallow receipts. */
    public function test_an_inactive_lane_device_falls_through_to_the_shared_one(): void
    {
        $shared = HardwareDevice::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'receipt_printer', 'name' => 'Shop printer',
            'connection_type' => 'browser', 'is_default' => true, 'is_active' => true,
        ]);
        HardwareDevice::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'register_id' => $this->lane1->id,
            'type' => 'receipt_printer', 'name' => 'Broken lane printer',
            'connection_type' => 'browser', 'is_default' => true, 'is_active' => false,
        ]);

        app(\App\Support\TenantContext::class)->set($this->tenant);

        $this->assertSame($shared->id, HardwareDevice::resolveForRegister($this->lane1->id)['receipt_printer']->id);
    }

    public function test_the_terminal_endpoint_reports_the_lanes_hardware(): void
    {
        HardwareDevice::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'register_id' => $this->lane2->id,
            'type' => 'receipt_printer', 'name' => 'Lane 2 printer',
            'connection_type' => 'browser', 'is_default' => true, 'is_active' => true,
        ]);

        $this->actingAsUser($this->cashierA)
            ->withHeader('X-Register-Id', $this->lane2->id)
            ->getJson('/api/v1/pos/terminal')
            ->assertOk()
            ->assertJsonPath('data.register.id', $this->lane2->id)
            ->assertJsonPath('data.devices.receipt_printer.name', 'Lane 2 printer');
    }

    // ── Parked tickets belong to the site ───────────────────────────

    /**
     * The customer who runs back for a forgotten item joins whichever queue is
     * shortest — so any lane must be able to finish the ticket.
     */
    public function test_a_ticket_parked_at_one_lane_is_visible_at_another(): void
    {
        $held = $this->actingAsUser($this->cashierA)
            ->withHeader('X-Register-Id', $this->lane1->id)
            ->postJson('/api/v1/pos/held', [
                'label' => 'Blue shirt', 'cart' => [['product_id' => $this->product->id, 'quantity' => 2]],
                'total_estimate' => 1000,
            ])->assertCreated()->json('data');

        $this->assertSame($this->lane1->id, $held['register_id']);

        $seen = $this->actingAsUser($this->cashierB)
            ->withHeader('X-Register-Id', $this->lane2->id)
            ->getJson('/api/v1/pos/held')->assertOk()->json('data');

        $this->assertCount(1, $seen);
        // …and it says who parked it, so the list stays readable at six lanes.
        $this->assertSame('Ayesha', $seen[0]['user']['name']);
        $this->assertSame('Lane 1', $seen[0]['register']['name']);
    }

    public function test_another_cashier_at_the_same_site_can_clear_a_parked_ticket(): void
    {
        $held = $this->actingAsUser($this->cashierA)->postJson('/api/v1/pos/held', [
            'cart' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->actingAsUser($this->cashierB)->deleteJson("/api/v1/pos/held/{$held['id']}")->assertOk();
        $this->assertNull(HeldSale::withoutTenancy()->find($held['id']));
    }

    /**
     * Resuming must be atomic. Two lanes opening the held list at the same
     * moment used to be able to load the same basket and both ring it — two
     * sales, two stock decrements, one customer.
     */
    public function test_only_one_lane_can_claim_a_parked_ticket(): void
    {
        $held = $this->actingAsUser($this->cashierA)->postJson('/api/v1/pos/held', [
            'label' => 'Family shop', 'cart' => [['product_id' => $this->product->id, 'quantity' => 4]],
            'total_estimate' => 2000,
        ])->assertCreated()->json('data');

        // Lane 1 gets it, cart and all.
        $this->actingAsUser($this->cashierA)->postJson("/api/v1/pos/held/{$held['id']}/claim")
            ->assertOk()
            ->assertJsonPath('data.label', 'Family shop')
            ->assertJsonPath('data.cart.0.quantity', 4);

        // Lane 3 was a moment late and is told so, rather than ringing it twice.
        $this->actingAsUser($this->cashierB)->postJson("/api/v1/pos/held/{$held['id']}/claim")
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'HELD_ALREADY_CLAIMED');

        $this->assertNull(HeldSale::withoutTenancy()->find($held['id']));
    }

    // ── The drawer a sale lands in ──────────────────────────────────

    /**
     * Cash accountability. The endpoint accepted any open shift in the tenant,
     * so cashier B could stamp their sale onto cashier A's drawer and leave A
     * carrying the variance — a ready-made cover for shrinkage.
     */
    public function test_a_cashier_cannot_ring_a_sale_onto_another_cashiers_drawer(): void
    {
        $aShift = $this->openShift($this->cashierA, $this->lane1)->assertCreated()->json('data');
        $this->openShift($this->cashierB, $this->lane2)->assertCreated();

        $this->actingAsUser($this->cashierB)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'cash_session_id' => $aShift['id'],       // not Bilal's shift
            'payment_method' => 'cash',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
            'amount_paid' => 500,
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['cash_session_id']]);

        // Ayesha's drawer is untouched.
        $closed = $this->actingAsUser($this->cashierA)
            ->postJson('/api/v1/pos/session/close', ['counted_cash' => 1000])->assertOk()->json('data');
        $this->assertEquals(0, $closed['cash_sales']);
    }

    public function test_a_refund_cannot_be_paid_out_of_another_cashiers_drawer(): void
    {
        $aShift = $this->openShift($this->cashierA, $this->lane1)->assertCreated()->json('data');
        $sale = $this->ringSale($this->cashierA, $aShift['id'], 2);
        $this->openShift($this->cashierB, $this->lane2)->assertCreated();

        $this->actingAsUser($this->cashierB)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'cash_session_id' => $aShift['id'],
            'refund_method' => 'cash',
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['cash_session_id']]);
    }

    /**
     * `pos_require_shift` shipped as a setting nothing read: a shop could insist
     * on shifts and still ring counter sales with no drawer attached, whose cash
     * belonged to no reconciliation and appeared in no shift report.
     */
    public function test_a_counter_sale_needs_an_open_shift_when_the_shop_requires_one(): void
    {
        $this->actingAsUser($this->owner)
            ->putJson('/api/v1/shop/settings', ['pos_require_shift' => true])->assertOk();

        $this->actingAsUser($this->cashierA)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
            'amount_paid' => 500,
        ])->assertStatus(409)->assertJsonPath('meta.error_code', 'SHIFT_REQUIRED');

        // With a shift open, the same sale goes through.
        $shift = $this->openShift($this->cashierA, $this->lane1)->assertCreated()->json('data');
        $this->ringSale($this->cashierA, $shift['id']);
    }

    /**
     * A one-person shop is not forced into shift ceremony — the requirement is
     * opt-in, and off is the shipped default.
     */
    public function test_a_shop_that_does_not_require_shifts_can_sell_without_one(): void
    {
        $this->actingAsUser($this->cashierA)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
            'amount_paid' => 500,
        ])->assertCreated();
    }

    /** Another SITE's tickets are not this counter's business. */
    public function test_another_branchs_parked_ticket_is_not_visible(): void
    {
        $second = Branch::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Gulberg', 'is_default' => false, 'is_active' => true,
        ]);
        HeldSale::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $second->id, 'user_id' => $this->cashierB->id,
            'cart' => [['product_id' => $this->product->id, 'quantity' => 1]], 'total_estimate' => 500,
        ]);

        // cashierA is pinned to no branch → Main; Gulberg's ticket is elsewhere.
        $seen = $this->actingAsUser($this->cashierA)->getJson('/api/v1/pos/held')->assertOk()->json('data');

        $this->assertCount(0, $seen);
    }
}
