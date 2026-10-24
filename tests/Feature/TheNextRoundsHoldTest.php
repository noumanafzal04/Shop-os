<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * The next rounds (2026-10-22/24, docs/qa/TESTER-REPORT-2026-10-21-next-rounds.md):
 * each thing the tester found, asked the way the tester asked it.
 */
class TheNextRoundsHoldTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $cashier;

    /** @var array<string, string> */
    private array $item = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->travelTo(Carbon::parse('2026-10-22 15:00:00', 'Asia/Karachi'));

        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'business_type' => 'retail', 'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->cashier = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create(['name' => 'Kamran']);
    }

    /** #19: banking more than the drawers hold never takes "Still in the shop" below nothing. */
    public function test_banking_past_the_drawers_stops_still_in_the_shop_at_nothing(): void
    {
        $this->aDrawerHolding(8000);

        // 600 more than the drawer holds — yesterday's takings from the safe, or a slip typed wrong.
        $this->as($this->owner)->postJson('/api/v1/pos/deposits', ['amount' => 8600])->assertCreated();

        $day = $this->as($this->owner)->getJson('/api/v1/pos/day')->assertOk()->json('data');
        $this->assertEquals(8600, $day['banked']);
        $this->assertEquals(0, $day['unbanked']);
        $this->assertEquals(600, $day['banked_beyond_drawers']);
    }

    /** #20: a deposit typed wrong is put right, or taken off, while its day is trading. */
    public function test_a_deposit_typed_wrong_is_corrected_or_removed(): void
    {
        $this->aDrawerHolding(8000);
        $typo = $this->as($this->owner)->postJson('/api/v1/pos/deposits', ['amount' => 16000, 'slip_number' => 'DEP-3'])
            ->assertCreated()->json('data.id');
        $never = $this->as($this->owner)->postJson('/api/v1/pos/deposits', ['amount' => 500])->assertCreated()->json('data.id');

        $this->as($this->owner)->putJson("/api/v1/pos/deposits/{$typo}", ['amount' => 1600, 'slip_number' => 'DEP-3', 'bank_name' => 'Meezan'])
            ->assertOk()->assertJsonPath('data.amount', '1600.00')->assertJsonPath('data.bank_name', 'Meezan');
        $this->as($this->owner)->deleteJson("/api/v1/pos/deposits/{$never}")->assertOk();

        $day = $this->as($this->owner)->getJson('/api/v1/pos/day')->assertOk()->json('data');
        $this->assertEquals(1600, $day['banked']);
        $this->assertEquals(6400, $day['unbanked']);
        $this->assertCount(1, $day['deposits']);
        // Both corrections are in the activity log.
        $this->assertDatabaseHas('audit_logs', ['auditable_id' => $typo, 'event' => 'updated']);
        $this->assertDatabaseHas('audit_logs', ['auditable_id' => $never, 'event' => 'deleted']);
    }

    /** #20: only who may record a deposit may correct one; and a closed day's banking is frozen. */
    public function test_a_deposit_is_corrected_by_its_keeper_and_not_after_the_close(): void
    {
        $this->aDrawerHolding(8000);
        $id = $this->as($this->owner)->postJson('/api/v1/pos/deposits', ['amount' => 3000])->assertCreated()->json('data.id');

        $this->as($this->cashier)->putJson("/api/v1/pos/deposits/{$id}", ['amount' => 1])->assertForbidden();
        $this->as($this->cashier)->deleteJson("/api/v1/pos/deposits/{$id}")->assertForbidden();

        $this->as($this->cashier)->postJson('/api/v1/pos/session/close', ['counted_cash' => 8000])->assertSuccessful();
        $dayId = $this->as($this->owner)->getJson('/api/v1/pos/day')->json('data.day.id');
        $this->as($this->owner)->postJson("/api/v1/pos/days/{$dayId}/close")->assertSuccessful();

        $this->as($this->owner)->deleteJson("/api/v1/pos/deposits/{$id}")
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'DAY_IS_CLOSED');
        $this->assertDatabaseHas('bank_deposits', ['id' => $id, 'amount' => 3000]);
    }

    /** #31: a throttled till can read how long to wait — the panel is another origin. */
    public function test_a_throttled_till_can_read_how_long_to_wait(): void
    {
        $this->assertContains('Retry-After', config('cors.exposed_headers'));
    }

    /**
     * #33: a cost that is not a whole number of paisa — 7.273 L at 255 is
     * 1,854.615 — gave Reports 345.38 and the Dashboard 345.39 for one day.
     */
    public function test_the_dashboard_and_the_report_give_one_profit_to_the_paisa(): void
    {
        $diesel = $this->as($this->owner)->postJson('/api/v1/products', [
            'name' => 'Diesel', 'item_type' => 'physical_product', 'sold_by' => 'weight', 'unit' => 'litre',
            'price' => 280, 'cost' => 255, 'tax_rate' => 0, 'track_inventory' => false,
        ])->assertCreated()->json('data.id');
        $this->as($this->cashier)->postJson('/api/v1/pos/session/open', ['opening_float' => 0])->assertSuccessful();
        foreach ([10, 7.273] as $litres) {
            $this->as($this->cashier)->postJson('/api/v1/sales', [
                'channel' => 'pos', 'payment_method' => 'card', 'amount_paid' => round($litres * 280, 2),
                'items' => [['product_id' => $diesel, 'quantity' => $litres]],
            ])->assertCreated();
        }

        $report = $this->as($this->owner)->getJson('/api/v1/reports/summary?period=custom&from=2026-10-22&to=2026-10-22')->assertOk()->json('data.totals');
        $dashboard = $this->as($this->owner)->getJson('/api/v1/dashboard')->assertOk()->json('data.today');

        // The cost has a half paisa in it (4,404.615): rounded at the end it
        // was 431.83 on the Dashboard; the report's own rows add up to 431.82.
        $this->assertEquals(4404.62, $report['cogs']);
        $this->assertEquals(431.82, $report['net_profit']);
        $this->assertEquals(431.82, $dashboard['profit']);
    }

    /** A cashier's drawer holding exactly this much cash: a float of 5,000 and a cash sale for the rest. */
    private function aDrawerHolding(float $cash): void
    {
        $this->item['Mug'] = $this->as($this->owner)->postJson('/api/v1/products', [
            'name' => 'Mug', 'item_type' => 'physical_product', 'price' => $cash - 5000, 'cost' => 0,
            'tax_rate' => 0, 'track_inventory' => true, 'stock_quantity' => 50,
        ])->assertCreated()->json('data.id');
        $this->as($this->cashier)->postJson('/api/v1/pos/session/open', ['opening_float' => 5000])->assertSuccessful();
        $this->as($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => $cash - 5000,
            'items' => [['product_id' => $this->item['Mug'], 'quantity' => 1]],
        ])->assertCreated();
    }

    private function as(User $user): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($user->createToken('t', ['access'])->plainTextToken);
    }
}
