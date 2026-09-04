<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchPrice;
use App\Models\City;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * "TWO THOUSAND KA DAAL DO."
 *
 * Nobody at a petrol pump asks for 7.449 litres. They hand over money, the
 * attendant sets the pump to that money, and the litres are whatever it buys.
 * So on these lines the AMOUNT is the fact and the quantity is derived — the
 * opposite of every other line in this system, and the reason it needs its own
 * file rather than a case bolted onto the sale tests.
 *
 * Two properties carry the whole feature, and they pull in opposite directions:
 *
 *   the money must be EXACT      — it is what the drawer will be counted against
 *   the rate must be the SERVER'S — or a client could buy fuel at its own price
 *
 * Everything below is one of those two, or the seam between them.
 */
class SellByAmountTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $station;

    private User $cashier;

    private Product $petrol;

    /** A tin of oil: sold by the unit, so it may never be sold by the rupee. */
    private Product $tin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Multan', 'is_active' => true]);
        $this->station = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'city_id' => $city->id,
            'business_type' => 'petroleum',
            'features' => BusinessTypes::defaultFeatures('petroleum'),
            'timezone' => 'UTC',
        ]);

        $this->cashier = User::factory()->shopOwner($this->station)->create(['name' => 'Owner']);

        $this->petrol = $this->weighed('Petrol', 268.50, litres: 10000);
        $this->tin = Product::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'type' => 'product',
            'name' => 'Engine oil 4L', 'price' => 4200, 'sold_by' => 'unit',
            'track_inventory' => true, 'stock_quantity' => 40, 'is_active' => true,
        ]);

        $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/session/open', ['opening_float' => 0]);
    }

    // ── The money is exact ──────────────────────────────────────────

    public function test_two_thousand_rupees_of_petrol_costs_two_thousand_rupees(): void
    {
        // 2000 / 268.50 = 7.4487... litres. Recomputed the other way,
        // 7.449 × 268.50 is Rs 2,000.06 — six paisa the customer never handed
        // over, on every sale of this shape.
        $this->ring(2000)->assertCreated();

        $sale = Sale::withoutTenancy()->where('tenant_id', $this->station->id)->firstOrFail();
        $line = $sale->items()->firstOrFail();

        $this->assertSame('2000.00', (string) $line->line_total);
        $this->assertSame('2000.00', (string) $sale->total);
        $this->assertSame('7.449', (string) $line->quantity);
    }

    public function test_the_litres_leave_the_tank_and_the_money_does_not_move(): void
    {
        $this->ring(2000)->assertCreated();

        // Stock is the DERIVED figure — three decimals of it.
        $this->assertSame('9992.551', (string) $this->petrol->fresh()->stock_quantity);
    }

    public function test_a_rate_that_divides_evenly_leaves_nothing_behind(): void
    {
        $even = $this->weighed('Kerosene', 250.00, litres: 1000);

        $this->ring(1000, $even)->assertCreated();

        $line = $this->newestSale()->items()->firstOrFail();

        $this->assertSame('4.000', (string) $line->quantity);
        $this->assertSame('1000.00', (string) $line->line_total);
    }

    // ── The rate is the server's ────────────────────────────────────

    public function test_the_amount_buys_less_fuel_when_the_shop_raises_its_rate(): void
    {
        // The whole safety argument in one case: an amount is not a price. Put
        // the rate up and the same money buys FEWER litres — it can never buy
        // the same litres cheaper.
        $this->ring(2000)->assertCreated();
        $cheap = (float) $this->newestSale()->items()->firstOrFail()->quantity;

        $this->petrol->forceFill(['price' => 300.00])->save();

        $this->ring(2000)->assertCreated();
        $dear = (float) $this->newestSale()->items()->firstOrFail()->quantity;

        $this->assertLessThan($cheap, $dear);
        // …and both cost exactly two thousand rupees.
        $this->assertSame(
            ['2000.00', '2000.00'],
            Sale::withoutTenancy()->where('tenant_id', $this->station->id)
                ->get()->map(fn (Sale $s) => (string) $s->total)->all(),
        );
    }

    public function test_a_branch_price_is_the_rate_an_amount_is_divided_by(): void
    {
        // A branch that sells cheaper gives MORE litres for the same money. If
        // the derivation used the tenant list price instead, this station would
        // hand over less fuel than the customer paid for and nothing would say
        // so — the money is right either way, which is what makes it silent.
        BranchPrice::withoutTenancy()->create([
            'tenant_id' => $this->station->id,
            'branch_id' => $this->branchId(),
            'product_id' => $this->petrol->id,
            'variant_id' => null,
            'price' => 200.00,
        ]);

        $this->ring(2000)->assertCreated();

        $line = Sale::withoutTenancy()->where('tenant_id', $this->station->id)
            ->firstOrFail()->items()->firstOrFail();

        $this->assertSame('10.000', (string) $line->quantity);
        $this->assertSame('200.00', (string) $line->unit_price);
    }

    public function test_a_price_tier_settles_at_the_quantity_it_is_asked_about(): void
    {
        // The rate depends on the quantity and the quantity on the rate. A tier
        // that only bites above 20 litres must still bite, or a bulk buyer pays
        // the small-quantity rate for a large-quantity purchase.
        $bulk = $this->weighed('Diesel', 250.00, litres: 5000);
        $bulk->forceFill(['price_tiers' => [['min_qty' => 20, 'price' => 200.00]]])->save();

        $this->ring(5000, $bulk)->assertCreated();

        $line = Sale::withoutTenancy()->where('tenant_id', $this->station->id)
            ->firstOrFail()->items()->firstOrFail();

        // 5000 / 200 = 25 litres, which is above the tier — and 5000 / 250 = 20,
        // which is exactly on it. Settling on the first pass would have charged
        // 250 for a purchase that qualifies for 200.
        $this->assertSame('200.00', (string) $line->unit_price);
        $this->assertSame('25.000', (string) $line->quantity);
        $this->assertSame('5000.00', (string) $line->line_total);
    }

    // ── What it refuses ─────────────────────────────────────────────

    public function test_a_thing_sold_by_the_unit_cannot_be_sold_by_the_rupee(): void
    {
        // "Rs 2000 of engine oil" is not a quantity of anything. The refusal is
        // the same rule that already stops a fractional quantity of a tin.
        $this->ring(2000, $this->tin)
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'AMOUNT_NOT_SELLABLE');
    }

    public function test_a_line_may_not_name_both_a_quantity_and_an_amount(): void
    {
        // Naming both is a client asking two different questions at once, and
        // whichever the server picked would be the wrong one half the time.
        $this->actingAsUser($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $this->petrol->id, 'quantity' => 10, 'amount' => 2000]],
            'payment_method' => 'cash',
            'amount_paid' => 2000,
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'QUANTITY_AND_AMOUNT');
    }

    public function test_a_line_must_name_one_of_them(): void
    {
        $this->actingAsUser($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $this->petrol->id]],
            'payment_method' => 'cash',
            'amount_paid' => 0,
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'NO_QUANTITY');
    }

    public function test_an_item_with_no_price_says_so_instead_of_dividing_by_it(): void
    {
        $free = $this->weighed('Water', 0.0, litres: 500);

        $this->ring(500, $free)
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'AMOUNT_WITHOUT_PRICE');
    }

    public function test_an_amount_too_small_to_buy_anything_is_refused(): void
    {
        // A thousandth of a litre is the smallest quantity this system stores.
        // Below it the sale would take money and dispense nothing.
        $this->ring(0.05)
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'AMOUNT_TOO_SMALL');
    }

    public function test_a_client_still_cannot_send_a_price(): void
    {
        // The one thing this feature must not have loosened. `unit_price` was
        // never accepted from HTTP and still is not, amount line or otherwise.
        $this->actingAsUser($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $this->petrol->id, 'amount' => 2000, 'unit_price' => 1.0]],
            'payment_method' => 'cash',
            'amount_paid' => 2000,
        ])->assertCreated();

        $line = Sale::withoutTenancy()->where('tenant_id', $this->station->id)
            ->firstOrFail()->items()->firstOrFail();

        $this->assertSame('268.50', (string) $line->unit_price);
    }

    // ── The offline seam, which is why `amount` exists at all ───────

    public function test_a_sale_queued_offline_is_worth_what_the_drawer_holds_even_after_the_rate_moves(): void
    {
        // A till with no line re-prices nothing itself — CreateSaleAction
        // re-prices every synced cart on purpose — and a forecourt's rate
        // changes overnight. Queued as litres, this sale would come back priced
        // at tomorrow's rate and stop matching the two thousand rupees actually
        // in the drawer. Queued as an amount, the money survives the change and
        // only the litres move, which is the half a dip reconciliation is for.
        $this->petrol->forceFill(['price' => 300.00])->save();

        $this->actingAsUser($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $this->petrol->id, 'amount' => 2000]],
            'payment_method' => 'cash',
            'amount_paid' => 2000,
            'offline_uuid' => (string) Str::uuid7(),
        ])->assertCreated();

        $sale = Sale::withoutTenancy()->where('tenant_id', $this->station->id)->firstOrFail();

        $this->assertSame('2000.00', (string) $sale->total);
        $this->assertSame('6.667', (string) $sale->items()->firstOrFail()->quantity);
    }

    // ── Fixtures ────────────────────────────────────────────────────

    private function weighed(string $name, float $price, float $litres): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'type' => 'product',
            'name' => $name, 'price' => $price, 'cost' => $price * 0.93,
            'unit' => 'Litre', 'sold_by' => 'weight',
            'track_inventory' => true, 'stock_quantity' => $litres, 'is_active' => true,
        ]);
    }

    private function ring(float $amount, ?Product $product = null): TestResponse
    {
        return $this->actingAsUser($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => ($product ?? $this->petrol)->id, 'amount' => $amount]],
            'payment_method' => 'cash',
            'amount_paid' => $amount,
        ]);
    }

    /**
     * The most recent sale — by created_at AND THEN BY ID.
     *
     * Two sales rung inside the same second tie on `created_at`, and
     * `latest('created_at')` then returns whichever the database felt like. Ids
     * are UUIDv7 and therefore time-ordered, so they break the tie correctly.
     * Without this the rate-change case read the FIRST sale's litres twice and
     * reported that raising the price changed nothing.
     */
    private function newestSale(): Sale
    {
        return Sale::withoutTenancy()->where('tenant_id', $this->station->id)
            ->orderByDesc('created_at')->orderByDesc('id')->firstOrFail();
    }

    private function branchId(): string
    {
        return Branch::withoutTenancy()
            ->where('tenant_id', $this->station->id)->where('is_default', true)->value('id');
    }

    private function actingAsUser(User $user): static
    {
        $this->actingAs($user);

        return $this;
    }
}
