<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Spreadsheet\XlsxReader;
use App\Support\Spreadsheet\Zip;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * THE WHOLE SHELF EXPORTS (garments round, #GS4, 2026-11-01).
 *
 * A shop of 20,002 items pressed Export and got an error page: "Allowed memory
 * size of 134217728 bytes exhausted". The export loaded every item — with its
 * sizes, packs and codes — as one list, then built every row as a second list,
 * then a third for the grid, before writing a byte. Memory grew with the shelf
 * until the server's 128 MB ran out; on the 2 GB box it would take a worker
 * down with it.
 *
 * Now the shelf is read a page at a time and written as it is read, into a
 * file that spills to disk — the memory an export takes is one page's, however
 * long the shelf is. These tests pin that, and that paging lost or repeated no
 * row on the way.
 */
class TheWholeShelfExportsTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private int $made = 0;

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
    }

    /** Items straight into the table — thousands of them, fast. Every third shares a name, so paging has ties to break. */
    private function stock(int $count): void
    {
        $rows = [];
        for ($i = 0; $i < $count; $i++) {
            $n = ++$this->made;
            $rows[] = [
                'id' => (string) Str::uuid7(),
                'tenant_id' => $this->shop->id,
                'type' => 'product',
                'item_type' => 'physical_product',
                'name' => 'Lawn Suit '.str_pad((string) intdiv($n, 3), 5, '0', STR_PAD_LEFT),
                'sku' => 'GS-'.str_pad((string) $n, 6, '0', STR_PAD_LEFT),
                'description' => str_repeat('Three-piece printed lawn, dupatta included. ', 4),
                'price' => 2000 + $n,
                'cost' => 1200 + $n,
                'stock_quantity' => $n % 40,
                'track_inventory' => true,
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }
        foreach (array_chunk($rows, 500) as $chunk) {
            DB::table('products')->insert($chunk);
        }
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /**
     * The CSV export, and the memory it took above what was in use before it —
     * measured once the file is written and before it is handed over, so what
     * is counted is the export's own work, not this test holding the whole
     * download as a string to read it.
     */
    private function exportCsv(): array
    {
        $as = $this->as();
        gc_collect_cycles();
        $before = memory_get_usage();
        memory_reset_peak_usage();
        $response = $as->get('/api/v1/products/export')->assertOk();
        $took = memory_get_peak_usage() - $before;

        return [$response->streamedContent(), $took];
    }

    /** @return string[] the SKU column of a CSV export, in its order */
    private function skus(string $csv): array
    {
        $lines = array_values(array_filter(explode("\n", ltrim($csv, "\xEF\xBB\xBF")), fn (string $l): bool => trim($l) !== ''));
        $head = str_getcsv(array_shift($lines));
        $at = array_search('SKU', $head, true);
        $this->assertIsInt($at, 'The export has a SKU column.');

        return array_map(fn (string $l): string => str_getcsv($l)[$at], $lines);
    }

    /**
     * THE POINT. Four times the shelf, not four times the memory: an export
     * that holds the whole list grows with it (and fails on this test); one
     * that reads a page at a time does not. The smaller shelf is a full page
     * already (1,000 items): one page, let go of before the next is read, is
     * the ceiling — not the shelf.
     */
    public function test_four_times_the_shelf_does_not_take_four_times_the_memory(): void
    {
        $this->stock(1000);
        $this->exportCsv(); // the first request loads code; it is not the export's own cost
        [, $small] = $this->exportCsv();

        $this->stock(3000);
        [$csv, $large] = $this->exportCsv();

        $this->assertCount(4000, $this->skus($csv));
        $this->assertLessThan(
            (int) ($small * 1.6),
            $large,
            sprintf('1,000 items took %.1f MB; 4,000 took %.1f MB — the export grows with the shelf.', $small / 1048576, $large / 1048576),
        );
    }

    /** Read a page at a time, every item comes out once — none lost at a page's edge, none twice — in name order. */
    public function test_every_item_comes_out_once_across_the_pages_in_name_order(): void
    {
        $this->stock(1234);

        [$csv] = $this->exportCsv();
        $skus = $this->skus($csv);

        $this->assertCount(1234, $skus);
        $this->assertCount(1234, array_unique($skus), 'No item is written twice.');
        $expected = array_map(fn (int $n): string => 'GS-'.str_pad((string) $n, 6, '0', STR_PAD_LEFT), range(1, 1234));
        $this->assertEqualsCanonicalizing($expected, $skus, 'No item is lost.');

        $names = DB::table('products')->where('tenant_id', $this->shop->id)->pluck('name', 'sku');
        $inOrder = array_map(fn (string $sku): string => $names[$sku], $skus);
        $sorted = $inOrder;
        sort($sorted, SORT_STRING);
        $this->assertSame($sorted, $inOrder, 'The sheet runs in name order, as before.');
    }

    /**
     * The order is asked for once, and every page is fetched by its ids. Paged
     * by offset, page 100 of the 50k shop re-read the 49,500 rows before it —
     * the export took 15 s, most of it walking past rows already written.
     */
    public function test_the_order_is_asked_once_and_no_page_walks_past_the_rows_before_it(): void
    {
        $this->stock(2500);
        $as = $this->as();

        $reads = [];
        DB::listen(function ($query) use (&$reads): void {
            if (preg_match('/^select .* from [`"]?products[`"]? /i', $query->sql)) {
                $reads[] = $query->sql;
            }
        });
        $csv = $as->get('/api/v1/products/export')->assertOk()->streamedContent();

        $this->assertCount(2500, $this->skus($csv));
        $this->assertSame([], array_values(array_filter($reads, fn (string $sql): bool => (bool) preg_match('/\boffset\b/i', $sql))), 'No page is an offset into the shelf.');
        $this->assertCount(1, array_filter($reads, fn (string $sql): bool => (bool) preg_match('/order by .*name/i', $sql)), 'The shelf is put in order once.');
    }

    /** The Excel export of a long shelf opens, holds every row, and its drop-downs reach past the last row. */
    public function test_a_long_shelf_exports_to_excel_whole(): void
    {
        $this->stock(3100);

        $response = $this->as()->get('/api/v1/products/export?format=xlsx')->assertOk();
        $bytes = $response->getContent();
        $this->assertTrue(Zip::looksLikeOne($bytes));

        $rows = XlsxReader::rows($bytes, 'Products');
        $this->assertCount(3101, $rows, 'The heading row and every item.');

        $sheet = Zip::open($bytes)->get('xl/worksheets/sheet1.xml');
        preg_match_all('/sqref="[A-Z]+2:[A-Z]+(\d+)"/', (string) $sheet, $ends);
        $this->assertNotEmpty($ends[1], 'The sheet has its drop-downs.');
        foreach ($ends[1] as $end) {
            $this->assertGreaterThanOrEqual(3101 + 500, (int) $end, 'A drop-down reaches past the last item, with room to add more.');
        }
    }
}
