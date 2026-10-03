<?php

namespace Tests\Feature;

use App\Actions\Sale\CancelSaleAction;
use App\Actions\Sale\CreateSaleAction;
use App\Models\City;
use App\Models\Plan;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\PlanLimits;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * HOW CLOSE IS THIS SHOP TO ITS CEILING, AND WHO SAYS SO.
 *
 * Three of the plan limits are reported and deliberately NOT enforced —
 * which is the right call for a till, because a hard stop in the middle of
 * a queue is the failure the whole offline module exists to avoid. What was
 * wrong was the silence beside it: a shop sailed past its included
 * transactions and nothing on either screen said a word.
 *
 * And the meter itself was counting the wrong thing. A CANCELLED sale is a
 * mistake somebody corrected; billing for it means billing a shop for
 * mis-keying. A REFUNDED one still counts, and that is not an inconsistency
 * — the sale happened, the goods went out and came back, and the system did
 * the work twice.
 */
class HowCloseToTheCeilingTest extends TestCase
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

        $plan = Plan::query()->create([
            'name' => 'Standard', 'code' => 'std-'.uniqid(), 'price' => 4999,
            'billing_period_months' => 1, 'max_orders_month' => 10, 'is_active' => true,
        ]);

        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'), 'timezone' => 'UTC',
            'plan_id' => $plan->id,
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();

        $this->rice = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'name' => 'Rice Bag',
            'price' => 100, 'cost' => 70, 'track_inventory' => false, 'is_active' => true,
        ]);

        app(TenantContext::class)->set($this->shop);
        auth()->setUser($this->owner);
    }

    private function ring(int $n = 1): Sale
    {
        $sale = null;
        foreach (range(1, $n) as $_) {
            $sale = app(CreateSaleAction::class)->execute([
                'channel' => 'walk_in',
                'items' => [['product_id' => $this->rice->id, 'quantity' => 1]],
                'payment_method' => 'cash',
                'amount_paid' => 500,
                'created_by' => $this->owner->id,
            ]);
        }

        return $sale;
    }

    private function row(string $key): array
    {
        foreach (PlanLimits::snapshot($this->shop->fresh()) as $r) {
            if ($r['key'] === $key) {
                return $r;
            }
        }

        $this->fail("No usage row for {$key}.");
    }

    public function test_a_cancelled_sale_is_not_billed_for(): void
    {
        $this->ring(3);
        $mistake = $this->ring();

        $this->assertSame(4, PlanLimits::usage($this->shop, 'orders_month'));

        app(CancelSaleAction::class)->execute($mistake, 'Rung in error');

        $this->assertSame(
            3,
            PlanLimits::usage($this->shop->fresh(), 'orders_month'),
            'A shop was being charged for its own typos.',
        );
    }

    /**
     * A REFUND IS NOT A CANCELLATION.
     *
     * The sale happened. The goods went out and came back, the system did
     * the work twice, and the bill stands.
     */
    public function test_a_refunded_sale_still_counts(): void
    {
        $sale = $this->ring();
        $sale->forceFill(['status' => 'refunded'])->save();

        $this->assertSame(1, PlanLimits::usage($this->shop->fresh(), 'orders_month'));
    }

    public function test_an_ordinary_month_says_nothing(): void
    {
        $this->ring(3);

        $row = $this->row('orders_month');
        $this->assertSame(30, $row['percent']);
        $this->assertSame('ok', $row['band']);
    }

    public function test_four_fifths_of_the_way_is_worth_a_word(): void
    {
        $this->ring(8);

        $row = $this->row('orders_month');
        $this->assertSame(80, $row['percent']);
        $this->assertSame('nearing', $row['band']);
    }

    public function test_nine_tenths_is_worth_a_call(): void
    {
        $this->ring(9);

        $this->assertSame('critical', $this->row('orders_month')['band']);
    }

    /**
     * AT the ceiling is not the same as PAST it.
     *
     * `reached` used to cover both, which meant a shop that had used exactly
     * what it paid for and a shop four thousand bills beyond it produced the
     * same word on the admin's list. The first needs no phone call at all;
     * the second has been unnoticed for a month.
     */
    public function test_exactly_at_the_ceiling_is_reached(): void
    {
        $this->ring(10);

        $row = $this->row('orders_month');
        $this->assertSame('reached', $row['band']);
        $this->assertSame(100, $row['percent']);
        $this->assertSame(0, $row['remaining']);
    }

    public function test_past_the_ceiling_says_so_without_stopping_the_till(): void
    {
        $this->ring(11);

        $row = $this->row('orders_month');
        $this->assertSame('over', $row['band']);
        $this->assertSame(110, $row['percent']);
        $this->assertSame(0, $row['remaining']);

        // AND THE TILL STILL RINGS. `orders_month` is reported, never
        // enforced: a hard stop mid-queue is the failure the whole offline
        // module exists to avoid.
        $this->assertNotNull($this->ring());
    }

    /**
     * UNLIMITED IS NOT ZERO PERCENT.
     *
     * A null plan column means no ceiling, and reporting it as 0% would sort
     * an unlimited shop to the top of a "least used" list and to the bottom
     * of a "nearest the limit" one.
     */
    public function test_an_unlimited_resource_has_no_percentage_at_all(): void
    {
        $this->ring(5);

        $row = $this->row('products');
        $this->assertTrue($row['unlimited']);
        $this->assertNull($row['percent']);
        $this->assertNull($row['band']);
    }

    /**
     * A POLICY IS NOT A QUOTA.
     *
     * `offline_days` reports the worst device currently out of contact. A
     * tablet three days out against a three-day window is a tablet that is
     * late, not a quota that is spent — and putting a billing word like
     * "reached" on it would read as an invoice.
     */
    public function test_a_policy_never_gets_a_usage_band(): void
    {
        $row = $this->row('offline_days');

        $this->assertNull($row['band']);
    }
}
