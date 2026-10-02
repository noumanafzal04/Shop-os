<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Services\StockReportService;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * A REPORT SENDS WHAT A SCREEN READS; AN EXPORT SENDS EVERYTHING.
 *
 * The stock valuation computed its totals over the whole catalogue — which it
 * must, because a valuation that misses a shelf is worse than a slow one —
 * and then shipped every line as well. On a load-test grocery that was
 * **1.14 MB in one response**, to a screen whose own code reads
 * `items.slice(0, 100)`. Dead stock was 938 KB the same way.
 *
 * Measured, not guessed: `php artisan loadtest:timings`.
 *
 * The cap is on the LINES only. The totals, the category split and the
 * `items_total` count are still computed over everything, so the figure a
 * shopkeeper acts on never changes — and the CSV export passes `limit: null`,
 * because the whole list is what an export IS.
 */
class AReportIsNotTheWholeShelfTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();

        // Comfortably past the cap, and each worth a different amount so the
        // ORDER of what survives it can be asserted.
        $rows = [];
        foreach (range(1, StockReportService::SCREEN_LINES + 60) as $n) {
            $rows[] = [
                'id' => (string) Str::uuid7(),
                'tenant_id' => $this->shop->id,
                'type' => 'product',
                'item_type' => 'physical_product',
                'name' => 'Item '.str_pad((string) $n, 4, '0', STR_PAD_LEFT),
                'price' => 100 + $n,
                'cost' => 50 + $n,
                'stock_quantity' => $n,
                'track_inventory' => true,
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }
        foreach (array_chunk($rows, 200) as $chunk) {
            DB::table('products')->insert($chunk);
        }
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    public function test_the_valuation_screen_is_sent_a_page_and_told_the_rest_exists(): void
    {
        $data = $this->as()->getJson('/api/v1/reports/valuation')->assertOk()->json('data');

        $this->assertSame(StockReportService::SCREEN_LINES, count($data['items']));
        $this->assertSame(StockReportService::SCREEN_LINES, $data['items_shown']);
        // THE POINT: the count is the truth even though the list is not.
        $this->assertSame(StockReportService::SCREEN_LINES + 60, $data['items_total']);
        $this->assertSame(StockReportService::SCREEN_LINES + 60, $data['totals']['lines']);
    }

    /**
     * THE FIGURE A SHOPKEEPER ACTS ON DID NOT MOVE.
     *
     * This is the half that makes the cap safe. Totalled by hand over every
     * row, against the report's own figure.
     */
    public function test_the_totals_are_still_over_the_whole_shelf(): void
    {
        $cost = 0.0;
        $retail = 0.0;
        foreach (Product::withoutTenancy()->where('tenant_id', $this->shop->id)->get() as $p) {
            $cost += (float) $p->cost * (float) $p->stock_quantity;
            $retail += (float) $p->price * (float) $p->stock_quantity;
        }

        $totals = $this->as()->getJson('/api/v1/reports/valuation')->assertOk()->json('data.totals');

        $this->assertSame(round($cost, 2), round((float) $totals['cost_value'], 2));
        $this->assertSame(round($retail, 2), round((float) $totals['retail_value'], 2));
    }

    public function test_dead_stock_is_capped_the_same_way_and_keeps_the_dearest(): void
    {
        $data = $this->as()->getJson('/api/v1/reports/dead-stock')->assertOk()->json('data');

        $this->assertSame(StockReportService::SCREEN_LINES, count($data['items']));
        $this->assertSame(StockReportService::SCREEN_LINES + 60, $data['items_total']);

        // Sorted by value BEFORE the cap, so the lines that survive are the
        // ones worth the most — not whichever the query happened to return
        // first. A cap applied to an unsorted list would be a random two
        // hundred, which is a worse report than a slow one.
        $values = array_map(fn (array $r): float => (float) $r['value'], $data['items']);
        $descending = $values;
        rsort($descending);

        $this->assertSame($descending, $values, 'the cap kept lines the report had not ranked yet');
        $this->assertGreaterThan((float) end($values), (float) $values[0]);
    }

    /** AND THE EXPORT IS NOT CAPPED, because that is what an export is for. */
    public function test_the_export_still_carries_every_line(): void
    {
        $csv = $this->as()->get('/api/v1/reports/valuation/export')->streamedContent();

        // Header plus one line per item, and the cap is well under that.
        $this->assertSame(
            StockReportService::SCREEN_LINES + 60 + 1,
            count(array_filter(explode("\n", trim($csv)))),
        );
    }
}
