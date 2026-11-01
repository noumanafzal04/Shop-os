<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * THE WHOLE SHELF IS VALUED (50k round, #GS6, 2026-11-01).
 *
 * A garments shop of 50,002 items opened Stock valuation and got "Allowed
 * memory size of 134217728 bytes exhausted". The report held every shelf row
 * as an object, loaded every item again as a full model to find the few that
 * had never moved — then looked each up in a list of all the others, one by
 * one — and valued every line a second time to send two hundred: 295 MB.
 *
 * Now the shelf comes off a cursor, the never-moved are asked of the database,
 * and only the lines a screen is sent are kept. These tests pin that the
 * memory stays flat as the shelf grows, that the figures did not move, and
 * that the two hundred lines sent are still exactly the two hundred worth the
 * most.
 */
class TheWholeShelfIsValuedTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private string $branchId;

    private int $made = 0;

    /** @var array<int, array{sku: string, qty: int, cost: int}> */
    private array $book = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->branchId = (string) Branch::withoutTenancy()->where('tenant_id', $this->shop->id)->where('is_default', true)->value('id');
    }

    /**
     * Items straight into the tables. Every other one has a shelf row; the rest
     * have never moved and live only in the product's own count — the two ways
     * a valuation finds stock.
     */
    private function stock(int $count): void
    {
        $products = [];
        $shelves = [];
        for ($i = 0; $i < $count; $i++) {
            $n = ++$this->made;
            $id = (string) Str::uuid7();
            $qty = 1 + $n % 40;
            $cost = 1000 + ($n * 7919) % 5000;     // spread, so the top lines are a real choice
            $products[] = [
                'id' => $id,
                'tenant_id' => $this->shop->id,
                'type' => 'product',
                'item_type' => 'physical_product',
                'name' => 'Lawn Suit '.$n,
                'sku' => 'GS-'.$n,
                'price' => $cost + 900,
                'cost' => $cost,
                'stock_quantity' => $qty,
                'track_inventory' => true,
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ];
            if ($n % 2 === 0) {
                $shelves[] = [
                    'id' => (string) Str::uuid7(),
                    'tenant_id' => $this->shop->id,
                    'branch_id' => $this->branchId,
                    'product_id' => $id,
                    'variant_id' => null,
                    'quantity' => $qty,
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
            }
            $this->book[] = ['sku' => 'GS-'.$n, 'qty' => $qty, 'cost' => $cost];
        }
        foreach (array_chunk($products, 500) as $chunk) {
            DB::table('products')->insert($chunk);
        }
        foreach (array_chunk($shelves, 500) as $chunk) {
            DB::table('branch_stock')->insert($chunk);
        }
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @return array{0: array<string, mixed>, 1: int} the report, and the memory it took above what was in use */
    private function report(string $url): array
    {
        $as = $this->as();
        gc_collect_cycles();
        $before = memory_get_usage();
        memory_reset_peak_usage();
        $data = $as->getJson($url)->assertOk()->json('data');

        return [$data, memory_get_peak_usage() - $before];
    }

    /**
     * What each item past the first thousand cost the report, in bytes. The
     * old report held each one as an object, a model and an array — about
     * 5 KB an item, 255 MB at 50,000. Read off a cursor, an item costs its raw
     * row in the database driver's buffer and nothing more.
     */
    private function assertEachItemIsCheap(int $small, int $large, int $extra, string $report): void
    {
        $perItem = ($large - $small) / $extra;
        $this->assertLessThan(
            1024,
            $perItem,
            sprintf('%s: 1,000 items took %.1f MB, %s took %.1f MB — %d bytes for each item more.', $report, $small / 1048576, number_format(1000 + $extra), $large / 1048576, (int) $perItem),
        );
    }

    /** THE POINT. Four times the shelf, not four times the memory — and the figure, to the rupee. */
    public function test_four_times_the_shelf_is_valued_in_the_same_memory(): void
    {
        $this->stock(1000);
        $this->report('/api/v1/reports/valuation'); // the first request loads code; not the report's own cost
        [, $small] = $this->report('/api/v1/reports/valuation');

        $this->stock(3000);
        [$data, $large] = $this->report('/api/v1/reports/valuation');

        $this->assertSame(4000, $data['totals']['lines']);
        $this->assertEqualsWithDelta(array_sum(array_map(fn (array $b): int => $b['qty'] * $b['cost'], $this->book)), $data['totals']['cost_value'], 0.001);
        $this->assertEachItemIsCheap($small, $large, 3000, 'Valuation');
    }

    /** Dead stock reads the same shelf the same way. Nothing here has ever sold, so every line is dead. */
    public function test_dead_stock_of_four_times_the_shelf_takes_the_same_memory(): void
    {
        $this->stock(1000);
        $this->report('/api/v1/reports/dead-stock');
        [, $small] = $this->report('/api/v1/reports/dead-stock');

        $this->stock(3000);
        [$data, $large] = $this->report('/api/v1/reports/dead-stock');

        $this->assertSame(4000, $data['totals']['lines']);
        $this->assertSame(4000, $data['totals']['never_sold'], 'Counted over every dead line, not only the ones sent.');
        $this->assertEachItemIsCheap($small, $large, 3000, 'Dead stock');
    }

    /**
     * Kept as it goes, the list is cut back every couple of thousand lines; the
     * two hundred sent must still be exactly the two hundred one sort of
     * everything would give, worth the most first.
     */
    public function test_the_lines_sent_are_the_ones_worth_the_most_across_every_cut(): void
    {
        $this->stock(5000);

        [$data] = $this->report('/api/v1/reports/valuation');

        $worth = array_map(fn (array $b): array => ['sku' => $b['sku'], 'value' => $b['qty'] * $b['cost']], $this->book);
        usort($worth, fn (array $a, array $b): int => $b['value'] <=> $a['value']);
        $top = array_slice($worth, 0, 200);

        $this->assertSame(200, $data['items_shown']);
        $this->assertSame(5000, $data['items_total']);
        $this->assertSame(
            array_map(fn (array $w): float => (float) $w['value'], $top),
            array_map(fn (array $i): float => (float) $i['cost_value'], $data['items']),
            'The lines sent are the most valuable, most first.',
        );
        $this->assertEqualsCanonicalizing(
            array_column(array_filter($top, fn (array $w): bool => $w['value'] > $top[199]['value']), 'sku'),
            array_column(array_filter($data['items'], fn (array $i): bool => $i['cost_value'] > $top[199]['value']), 'sku'),
            'And they are the right items, not only the right amounts.',
        );
    }
}
