<?php

namespace Tests\Feature;

use App\Actions\Sale\CreateSaleAction;
use App\Models\City;
use App\Models\Plan;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\PlanLimits;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE ROOM PAST THE INCLUDED FIGURE — and the two things that must never
 * happen at the edge of it.
 *
 * A bills-a-month allowance is a forecast. Shops get it wrong, Ramzan
 * happens, a wedding season happens. What the software does at the moment
 * the forecast turns out low is the single most consequential decision in
 * this whole pricing model, and there are exactly two wrong answers:
 *
 *   STOP THE TILL     A shop with customers in it and goods on the counter
 *                     cannot take money. Whatever that saves in hosting it
 *                     costs twenty times over in the phone call, and it is
 *                     the precise failure the offline module exists to
 *                     prevent — done to ourselves, on purpose, for an
 *                     invoice.
 *
 *   SAY NOTHING       The shop sails 4,000 bills past its plan, nobody
 *                     notices for a month, and the conversation that
 *                     follows is a bill nobody expected.
 *
 * So: the meter counts, the words get sharper, the till keeps ringing.
 *
 * ── And the other half: a plan change is not a new month ────────────────
 *
 * Upgrading mid-month must not reset the meter. 4,500 used on Basic becomes
 * 4,500 of Pro's 100,000 — not zero — because the work was done and the
 * period has not ended. The temptation to zero it is strong and it is how a
 * platform loses a month of revenue every time somebody upgrades.
 */
class GraceBeforeTheWallTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $rice;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);

        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'), 'timezone' => 'UTC',
            'plan_id' => $this->plan('Basic', 10, grace: 5)->id,
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();

        $this->rice = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'name' => 'Rice Bag',
            'price' => 100, 'cost' => 70, 'track_inventory' => false, 'is_active' => true,
        ]);

        app(TenantContext::class)->set($this->shop);
        auth()->setUser($this->owner);
    }

    private function plan(string $name, ?int $bills, ?int $grace = null): Plan
    {
        return Plan::query()->create([
            'name' => $name, 'code' => strtolower($name).'-'.uniqid(), 'price' => 2499,
            'billing_period_months' => 1, 'is_active' => true,
            'max_orders_month' => $bills, 'grace_orders_month' => $grace,
        ]);
    }

    private function ring(int $n = 1): void
    {
        foreach (range(1, $n) as $_) {
            app(CreateSaleAction::class)->execute([
                'channel' => 'walk_in',
                'items' => [['product_id' => $this->rice->id, 'quantity' => 1]],
                'payment_method' => 'cash',
                'amount_paid' => 500,
                'created_by' => $this->owner->id,
            ]);
        }
    }

    private function row(string $key = 'orders_month'): array
    {
        foreach (PlanLimits::snapshot($this->shop->fresh()) as $r) {
            if ($r['key'] === $key) {
                return $r;
            }
        }

        $this->fail("No usage row for {$key}.");
    }

    // ── The words, in order ─────────────────────────────────────────────

    public function test_the_included_figure_and_the_room_after_it_are_both_stated(): void
    {
        $row = $this->row();

        $this->assertSame(10, $row['limit']);
        $this->assertSame(5, $row['grace']);
        // The same fact said the way a person reads it, so nobody has to add
        // 10 and 5 while looking at a number that says 12.
        $this->assertSame(15, $row['grace_until']);
    }

    public function test_at_the_included_figure_nothing_is_wrong(): void
    {
        $this->ring(10);

        $this->assertSame('reached', $this->row()['band']);
    }

    public function test_one_past_it_is_grace_and_not_an_incident(): void
    {
        $this->ring(11);

        $this->assertSame('grace', $this->row()['band']);
    }

    public function test_past_the_grace_as_well_is_an_account_to_ring(): void
    {
        $this->ring(16);

        $this->assertSame('over', $this->row()['band']);
    }

    /**
     * THE WHOLE POINT.
     *
     * Six bills past the grace, and the next one still rings. If this ever
     * fails, nothing else in this file matters.
     */
    public function test_the_till_never_stops(): void
    {
        $this->ring(21);

        $this->ring();

        $this->assertSame(22, PlanLimits::usage($this->shop->fresh(), 'orders_month'));
        $this->assertFalse($this->row()['blocks'], 'The bills meter must never refuse a sale.');
    }

    /**
     * A SHOP CANNOT BE SLIGHTLY OVER ITS BRANCHES.
     *
     * Grace belongs to a forecast. Branches are a fact — a fourth shop was
     * opened or it was not — and offering room there would just be a ceiling
     * that lies about where it is.
     */
    public function test_only_the_forecast_gets_room(): void
    {
        $this->assertNull($this->row('branches')['grace']);
        $this->assertNull($this->row('staff')['grace']);
        $this->assertSame(0, PlanLimits::grace($this->shop, 'branches'));
    }

    // ── A plan change is not a new month ────────────────────────────────

    /**
     * UPGRADING MID-MONTH CARRIES THE METER ACROSS.
     *
     * 11 bills rung on Basic are 11 bills rung. Moving to Pro raises the
     * ceiling and touches nothing else: the shop reads 11 / 100, not 0 / 100.
     */
    public function test_an_upgrade_does_not_reset_the_meter(): void
    {
        $this->ring(11);
        $this->assertSame(11, PlanLimits::usage($this->shop->fresh(), 'orders_month'));

        $this->shop->forceFill(['plan_id' => $this->plan('Pro', 100)->id])->save();

        $row = $this->row();
        $this->assertSame(11, $row['used'], 'A plan change reset the usage meter.');
        $this->assertSame(100, $row['limit']);
        $this->assertSame('ok', $row['band']);
    }

    /**
     * AND A SHOP ALREADY OVER ITS OLD PLAN KEEPS ITS HISTORY.
     *
     * 16 bills on a 10-bill plan, then an upgrade: 16 of 100. Not zero, and
     * not "16 over" either — the overage was real and the new ceiling simply
     * swallows it.
     */
    public function test_an_upgrade_out_of_overage_keeps_the_count(): void
    {
        $this->ring(16);
        $this->assertSame('over', $this->row()['band']);

        $this->shop->forceFill(['plan_id' => $this->plan('Pro', 100)->id])->save();

        $this->assertSame(16, $this->row()['used']);
        $this->assertSame('ok', $this->row()['band']);
    }

    /**
     * A DOWNGRADE DOES NOT DELETE ANYTHING EITHER.
     *
     * The shop that rang 11 on Pro and moves to Basic reads 11 / 10 — over,
     * visible, and still trading. Nothing is removed and nothing is refused;
     * it is a conversation, not an enforcement action.
     */
    public function test_a_downgrade_shows_the_excess_rather_than_hiding_it(): void
    {
        $this->shop->forceFill(['plan_id' => $this->plan('Pro', 100)->id])->save();
        $this->ring(11);
        $this->assertSame('ok', $this->row()['band']);

        $this->shop->forceFill(['plan_id' => $this->plan('Tiny', 10)->id])->save();

        $row = $this->row();
        $this->assertSame(11, $row['used']);
        $this->assertSame(10, $row['limit']);
        $this->assertSame('over', $row['band']);
    }
}
