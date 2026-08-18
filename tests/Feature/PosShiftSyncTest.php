<?php

namespace Tests\Feature;

use App\Models\CashMovement;
use App\Models\CashSession;
use App\Models\PosDevice;
use App\Models\Register;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Where shifts opened, moved and counted with no server arrive.
 *
 * The till was built to trade through an outage and then put the whole
 * capability behind a gate that needed the server: no shift, no tender. A shop
 * whose line was already down at opening time could not start a shift, so it
 * could not sell — on the morning the feature exists for.
 *
 * Two rules run through every test here, and they pull in opposite directions:
 *
 *   nothing that HAPPENED may be refused — a drawer that has been used cannot
 *                                          be un-used by rejecting it on arrival
 *   nothing may happen TWICE            — one lost acknowledgement must not
 *                                          open two shifts or pay out twice
 */
class PosShiftSyncTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $cashier;

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
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @param  array<int, array<string, mixed>>  $operations */
    private function sync(array $operations, ?string $deviceId = null): TestResponse
    {
        return $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/sync/shifts', [
            'device_id' => $deviceId,
            'operations' => $operations,
        ]);
    }

    private function openOp(string $sessionId, array $over = []): array
    {
        return array_merge([
            'op' => (string) Str::uuid(),
            'kind' => 'open',
            'at' => '2026-08-18T04:00:00Z',
            'session_id' => $sessionId,
            'opening_float' => 3000,
        ], $over);
    }

    // ── Opening ─────────────────────────────────────────────────────

    public function test_a_shift_opened_with_no_server_arrives_under_the_tills_own_id(): void
    {
        $id = (string) Str::uuid();

        $this->sync([$this->openOp($id)])
            ->assertOk()
            ->assertJsonPath('data.results.0.status', 'applied')
            ->assertJsonPath('data.results.0.session_id', $id);

        // The id has to be the till's, because the sales queued behind it
        // already name it. A server-minted id would orphan every one of them.
        $session = CashSession::withoutGlobalScopes()->find($id);
        $this->assertNotNull($session);
        $this->assertSame('open', $session->status);
        $this->assertEquals(3000, $session->opening_float);
    }

    public function test_it_belongs_to_the_day_it_was_opened_not_the_day_it_arrived(): void
    {
        Carbon::setTestNow('2026-08-21 10:00:00');
        $id = (string) Str::uuid();

        $this->sync([$this->openOp($id, ['at' => '2026-08-18T04:00:00Z'])])->assertOk();

        $session = CashSession::withoutGlobalScopes()->find($id);
        // Opened Tuesday, arrived Friday. Taking the arrival time would move a
        // whole day's takings into the wrong trading day, and silently — every
        // figure would still add up.
        $this->assertSame('2026-08-18', $session->opened_at->toDateString());
        $this->assertSame('2026-08-21', $session->synced_at->toDateString());
        Carbon::setTestNow();
    }

    public function test_a_replayed_open_does_not_produce_a_second_drawer(): void
    {
        $id = (string) Str::uuid();
        $op = $this->openOp($id);

        $this->sync([$op])->assertOk()->assertJsonPath('data.results.0.status', 'applied');
        $this->sync([$op])->assertOk()->assertJsonPath('data.results.0.status', 'duplicate');

        $this->assertSame(1, CashSession::withoutGlobalScopes()->where('id', $id)->count());
    }

    public function test_practice_is_fixed_at_open(): void
    {
        $id = (string) Str::uuid();
        $this->sync([$this->openOp($id, ['is_training' => true])])->assertOk();

        $this->assertTrue(CashSession::withoutGlobalScopes()->find($id)->is_training);
    }

    public function test_a_lane_already_held_is_recorded_and_the_shift_still_lands(): void
    {
        $register = Register::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Lane 3', 'is_active' => true,
        ]);
        $other = User::factory()->tenantStaff($this->tenant, ['sales.manage'])->create();
        CashSession::withoutGlobalScopes()->create([
            'tenant_id' => $this->tenant->id, 'register_id' => $register->id,
            'user_id' => $other->id, 'status' => 'open', 'opening_float' => 1000,
            'opened_at' => now(),
        ]);

        $id = (string) Str::uuid();
        $response = $this->sync([$this->openOp($id, ['register_id' => $register->id])])->assertOk();

        // Recorded, NOT refused. The drawer has already been used — refusing it
        // would orphan every sale rung into it and leave counted cash belonging
        // to nothing.
        $this->assertSame('applied', $response->json('data.results.0.status'));
        $violations = $response->json('data.results.0.violations');
        $this->assertNotEmpty($violations);
        $this->assertStringContainsString('Lane 3', $violations[0]);

        $this->assertNotNull(CashSession::withoutGlobalScopes()->find($id)->offline_violations);
    }

    public function test_the_device_that_held_the_queue_is_recorded(): void
    {
        $device = PosDevice::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Counter tablet', 'status' => 'active',
        ]);
        $id = (string) Str::uuid();

        $this->sync([$this->openOp($id)], $device->id)->assertOk();

        // "Whose unsent shift was this" is a DEVICE question — the queue lives
        // on the tablet, not on the lane.
        $this->assertSame($device->id, CashSession::withoutGlobalScopes()->find($id)->pos_device_id);
    }

    // ── Movements ───────────────────────────────────────────────────

    public function test_a_replayed_payout_does_not_leave_the_drawer_short(): void
    {
        $id = (string) Str::uuid();
        $this->sync([$this->openOp($id)])->assertOk();

        $move = [
            'op' => (string) Str::uuid(), 'kind' => 'movement', 'at' => '2026-08-18T06:00:00Z',
            'session_id' => $id, 'type' => 'paid_out', 'amount' => 500, 'reason' => 'Chai',
        ];

        $this->sync([$move])->assertOk()->assertJsonPath('data.results.0.status', 'applied');
        $this->sync([$move])->assertOk()->assertJsonPath('data.results.0.status', 'duplicate');

        // Two paid_outs of the same amount on one shift are an ordinary thing
        // for a shop to do, so nothing but the key can tell a replay from a
        // real second payout.
        $this->assertSame(1, CashMovement::withoutGlobalScopes()->where('cash_session_id', $id)->count());
    }

    public function test_a_movement_whose_shift_has_not_arrived_is_retryable_not_lost(): void
    {
        $response = $this->sync([[
            'op' => (string) Str::uuid(), 'kind' => 'movement', 'at' => '2026-08-18T06:00:00Z',
            'session_id' => (string) Str::uuid(), 'type' => 'paid_out', 'amount' => 500,
        ]])->assertOk();

        $this->assertSame('failed', $response->json('data.results.0.status'));
        // Retryable, because the next flush carries the open. Marking it failed
        // for good would throw away money that left the drawer.
        $this->assertTrue($response->json('data.results.0.retryable'));
    }

    public function test_a_payout_bigger_than_the_drawer_is_still_recorded(): void
    {
        $id = (string) Str::uuid();
        $this->sync([$this->openOp($id, ['opening_float' => 100])])->assertOk();

        $response = $this->sync([[
            'op' => (string) Str::uuid(), 'kind' => 'movement', 'at' => '2026-08-18T06:00:00Z',
            'session_id' => $id, 'type' => 'paid_out', 'amount' => 5000, 'reason' => 'Supplier',
        ]])->assertOk();

        // The drawer ceiling is a LIVE control — it exists so a cashier is told
        // to drop cash before the box holds too much. On arrival the money has
        // already gone, hours ago, and refusing is the one thing that cannot
        // help.
        $this->assertSame('applied', $response->json('data.results.0.status'));
    }

    // ── Closing ─────────────────────────────────────────────────────

    public function test_a_drawer_counted_with_no_server_closes_on_arrival(): void
    {
        $id = (string) Str::uuid();
        $this->sync([$this->openOp($id)])->assertOk();

        $this->sync([[
            'op' => (string) Str::uuid(), 'kind' => 'close', 'at' => '2026-08-18T14:00:00Z',
            'session_id' => $id, 'counted_cash' => 3200, 'notes' => 'Counted at the till',
        ]])->assertOk()->assertJsonPath('data.results.0.shift_status', 'closed');

        $session = CashSession::withoutGlobalScopes()->find($id);
        $this->assertEquals(3200, $session->counted_cash);
        // The moment the cashier counted, not the moment the line came back.
        $this->assertSame('2026-08-18', $session->closed_at->toDateString());
    }

    public function test_a_replayed_close_does_not_count_the_drawer_twice(): void
    {
        $id = (string) Str::uuid();
        $this->sync([$this->openOp($id)])->assertOk();

        $close = [
            'op' => (string) Str::uuid(), 'kind' => 'close', 'at' => '2026-08-18T14:00:00Z',
            'session_id' => $id, 'counted_cash' => 3200,
        ];

        $this->sync([$close])->assertOk()->assertJsonPath('data.results.0.status', 'applied');
        $this->sync([$close])->assertOk()->assertJsonPath('data.results.0.status', 'duplicate');

        $this->assertEquals(3200, CashSession::withoutGlobalScopes()->find($id)->counted_cash);
    }

    // ── The batch ───────────────────────────────────────────────────

    public function test_one_bad_operation_does_not_cost_the_others(): void
    {
        $good = (string) Str::uuid();

        $response = $this->sync([
            $this->openOp($good),
            // Names a shift that does not exist and never will in this batch.
            ['op' => (string) Str::uuid(), 'kind' => 'close', 'at' => '2026-08-18T14:00:00Z',
                'session_id' => (string) Str::uuid(), 'counted_cash' => 100],
        ])->assertOk();

        $this->assertSame('applied', $response->json('data.results.0.status'));
        $this->assertSame('failed', $response->json('data.results.1.status'));
        // The whole point of per-operation results: a till must be able to
        // retire exactly what landed and retry exactly what did not.
        $this->assertSame(1, $response->json('data.accepted'));
    }

    public function test_a_till_may_not_claim_a_system_movement_happened(): void
    {
        $id = (string) Str::uuid();
        $this->sync([$this->openOp($id)])->assertOk();

        // Only the MANUAL types. A system movement is written by the flow that
        // moved the money — a supplier paid, a void handed back — and a till
        // that could assert one could fabricate a payment.
        $this->sync([[
            'op' => (string) Str::uuid(), 'kind' => 'movement', 'at' => '2026-08-18T06:00:00Z',
            'session_id' => $id, 'type' => 'supplier_out', 'amount' => 500,
        ]])->assertStatus(422);
    }
}
