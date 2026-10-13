<?php

namespace Tests\Feature;

use App\Models\SaleItem;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Illuminate\Testing\PendingCommand;
use Tests\TestCase;

/**
 * OLD SALES OF A SIZE ARE RE-COSTED FROM WHAT WAS PAID FOR THAT SIZE — OR LEFT.
 *
 * Before 2026-10-13 a size's sale line was costed at the design's cost. The
 * user's rule for mending them: only from a verified purchase or stock record,
 * never a guess. So a line takes the price on the order line of the LAST
 * delivery of that very size that had landed before it was sold; with no such
 * delivery it is left exactly as it is. And nothing is written unless asked.
 */
class SizeCostsFromPurchasesTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private array $kurta;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        Carbon::setTestNow('2026-10-01 10:00:00');
        $this->shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->kurta = $this->as()->postJson('/api/v1/products', [
            'name' => 'Cotton Kurta', 'item_type' => 'physical_product', 'price' => 2950, 'cost' => 1600, 'track_inventory' => true,
            'variants' => [['name' => 'M', 'price' => 2950, 'stock_quantity' => 10], ['name' => 'XL', 'price' => 2950, 'stock_quantity' => 10]],
        ])->assertCreated()->json('data');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function sizeId(string $name): string
    {
        return collect($this->kurta['variants'])->firstWhere('name', $name)['id'];
    }

    /** A delivery of one size, at a price, received on the day the clock says. */
    private function delivered(string $size, float $cost): void
    {
        $supplier = $this->as()->postJson('/api/v1/suppliers', ['name' => 'Faisalabad Mills '.$size.$cost])->assertCreated()->json('data.id');
        $po = $this->as()->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplier, 'order_date' => now()->toDateString(), 'status' => 'ordered',
            'items' => [['product_id' => $this->kurta['id'], 'variant_id' => $this->sizeId($size), 'quantity' => 5, 'unit_cost' => $cost]],
        ])->assertCreated()->json('data');
        $this->as()->postJson("/api/v1/purchase-orders/{$po['id']}/receive", [])->assertOk();
    }

    /** A sale of one size — and the cost the OLD code wrote on it: the design's. */
    private function soldTheOldWay(string $size): string
    {
        $sale = $this->as()->postJson('/api/v1/sales', [
            'channel' => 'pos', 'items' => [['product_id' => $this->kurta['id'], 'variant_id' => $this->sizeId($size), 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 2950,
        ])->assertCreated()->json('data');
        $line = SaleItem::withoutTenancy()->where('sale_id', $sale['id'])->sole();
        $line->forceFill(['unit_cost' => 1600])->save();

        return $line->id;
    }

    private function costOf(string $line): float
    {
        return (float) SaleItem::withoutTenancy()->whereKey($line)->value('unit_cost');
    }

    private function mend(array $options = []): PendingCommand
    {
        return $this->artisan('shopos:size-costs-from-purchases', ['--until' => '2026-10-31 23:59', ...$options]);
    }

    private function aMonth(): array
    {
        Carbon::setTestNow('2026-10-02 10:00:00');
        $this->delivered('M', 1750);
        Carbon::setTestNow('2026-10-03 10:00:00');
        $m = $this->soldTheOldWay('M');
        $xl = $this->soldTheOldWay('XL');           // no XL was ever delivered
        Carbon::setTestNow('2026-10-04 10:00:00');
        $this->delivered('M', 1900);                 // after the sale: not what that sale cost

        return [$m, $xl];
    }

    public function test_it_says_what_it_would_do_and_saves_nothing(): void
    {
        [$m, $xl] = $this->aMonth();

        $this->mend()
            ->expectsOutputToContain('1,600.00 → 1,750.00')
            ->expectsOutputToContain('1 would change')
            ->expectsOutputToContain('Nothing was saved')
            ->assertSuccessful();

        $this->assertSame(1600.0, $this->costOf($m), 'a look was taken for a change');
        $this->assertSame(1600.0, $this->costOf($xl));
    }

    public function test_applied_a_size_takes_the_price_of_its_last_delivery_before_the_sale(): void
    {
        [$m, $xl] = $this->aMonth();

        $this->mend(['--apply' => true])->expectsOutputToContain('1 changed')->assertSuccessful();

        $this->assertSame(1750.0, $this->costOf($m), 'the medium was not re-costed from its own delivery (or took the one that came after it)');
        $this->assertSame(1600.0, $this->costOf($xl), 'a size with no delivery on record was given a cost — a guess');
    }

    public function test_a_size_never_delivered_is_counted_and_left(): void
    {
        [, $xl] = $this->aMonth();

        $this->mend(['--apply' => true])->expectsOutputToContain('1 left as they were')->assertSuccessful();
        $this->assertSame(1600.0, $this->costOf($xl));
    }

    public function test_running_it_twice_changes_nothing_the_second_time(): void
    {
        $this->aMonth();
        $this->mend(['--apply' => true])->assertSuccessful();

        $this->mend(['--apply' => true])->expectsOutputToContain('0 changed, 1 already right')->assertSuccessful();
    }

    public function test_sales_after_the_fix_went_live_are_not_touched(): void
    {
        [$m] = $this->aMonth();

        $this->artisan('shopos:size-costs-from-purchases', ['--until' => '2026-10-02 23:59', '--apply' => true])
            ->expectsOutputToContain('0 size line(s) looked at')
            ->assertSuccessful();
        $this->assertSame(1600.0, $this->costOf($m));
    }

    public function test_one_shop_only_when_asked(): void
    {
        [$m] = $this->aMonth();

        $this->mend(['--apply' => true, '--tenant' => 'someone-else'])->expectsOutputToContain('0 size line(s) looked at')->assertSuccessful();
        $this->assertSame(1600.0, $this->costOf($m));
    }

    public function test_of_two_deliveries_before_the_sale_the_later_one_is_what_it_cost(): void
    {
        Carbon::setTestNow('2026-10-02 10:00:00');
        $this->delivered('M', 1700);
        Carbon::setTestNow('2026-10-02 16:00:00');
        $this->delivered('M', 1750);
        Carbon::setTestNow('2026-10-03 10:00:00');
        $m = $this->soldTheOldWay('M');

        $this->mend(['--apply' => true])->assertSuccessful();
        $this->assertSame(1750.0, $this->costOf($m), 'an older delivery was taken for what the size cost');
    }

    public function test_a_size_ordered_but_not_delivered_has_no_record(): void
    {
        // One order for both sizes; only the Mediums came.
        Carbon::setTestNow('2026-10-02 10:00:00');
        $supplier = $this->as()->postJson('/api/v1/suppliers', ['name' => 'Faisalabad Mills'])->assertCreated()->json('data.id');
        $po = $this->as()->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplier, 'order_date' => now()->toDateString(), 'status' => 'ordered',
            'items' => [
                ['product_id' => $this->kurta['id'], 'variant_id' => $this->sizeId('M'), 'quantity' => 5, 'unit_cost' => 1750],
                ['product_id' => $this->kurta['id'], 'variant_id' => $this->sizeId('XL'), 'quantity' => 5, 'unit_cost' => 1500],
            ],
        ])->assertCreated()->json('data');
        $mLine = collect($po['items'])->firstWhere('variant_id', $this->sizeId('M'))['id'];
        $this->as()->postJson("/api/v1/purchase-orders/{$po['id']}/receive", ['items' => [['id' => $mLine, 'quantity' => 5]]])->assertOk();
        Carbon::setTestNow('2026-10-03 10:00:00');
        $xl = $this->soldTheOldWay('XL');

        $this->mend(['--apply' => true])->assertSuccessful();
        $this->assertSame(1600.0, $this->costOf($xl), 'a size was costed from an order line that never arrived');
    }

    public function test_it_will_not_run_without_being_told_until_when(): void
    {
        $this->artisan('shopos:size-costs-from-purchases')->assertExitCode(2);
    }
}
