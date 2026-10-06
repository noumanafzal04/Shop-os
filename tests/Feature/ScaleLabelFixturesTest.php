<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * SCALE LABELS, as the till has to read them WITH NO SERVER.
 *
 * A mart weighs loose sugar on a scale that prints a label; the label's
 * barcode carries the item's PLU and the weight. Online, the till sends the
 * code here and is told "sugar, 1.5 kg". Offline it looked the thirteen
 * digits up in its own barcode index, found nothing, and said "Nothing here
 * matches" — so a shop whose line dropped could not sell anything it weighs.
 * The settings that say how to read the label were already being shipped to
 * the till, and read by nothing.
 *
 * The till now reads the label itself. These are the answers it has to get:
 * each one is asked of the real lookup endpoint and written down, and the
 * panel reads the same labels with its own code. A generator that re-derived
 * the answers would agree with itself for ever.
 *
 * Run with `SHOPOS_WRITE_FIXTURES=1` to rewrite, then copy to the panel:
 *
 *     cp tests/fixtures/scale-labels.json ../panel/src/modules/offline/lookup/fixtures/
 */
class ScaleLabelFixturesTest extends TestCase
{
    use RefreshDatabase;

    private const VERSION = 1;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();

        // The shelf every label is read against.
        foreach ($this->shelf() as $row) {
            Product::withoutTenancy()->create($row + [
                'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
                'sold_by' => 'weight', 'stock_quantity' => 100, 'track_inventory' => true, 'is_active' => true,
            ]);
        }
    }

    /** @return list<array<string, mixed>> */
    private function shelf(): array
    {
        return [
            ['name' => 'Loose Sugar', 'plu_code' => '21', 'price' => 180, 'discount_price' => null],
            // The scale's own zero-padded form, stored as typed.
            ['name' => 'Loose Rice', 'plu_code' => '000305', 'price' => 320, 'discount_price' => null],
            // On sale: a PRICE label is turned back into a weight at the price being charged.
            ['name' => 'Loose Daal', 'plu_code' => '77', 'price' => 400, 'discount_price' => 360],
            // A two-digit prefix leaves five digits of PLU, not six.
            ['name' => 'Loose Tea', 'plu_code' => '4410', 'price' => 1200, 'discount_price' => null],
        ];
    }

    private function ask(array $settings, string $code): array
    {
        $this->tenant->forceFill(['settings' => $settings])->save();
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        $res = $this->withToken($token)->getJson('/api/v1/pos/lookup?code='.$code);

        if ($res->status() !== 200) {
            return ['found' => false, 'error_code' => $res->json('meta.error_code')];
        }

        $scale = $res->json('data.scale');

        return [
            'found' => true,
            'name' => $res->json('data.product.name'),
            // Null when the code was answered as an ordinary barcode — which
            // for these labels would itself be the bug.
            'quantity' => $scale === null ? null : (float) $scale['quantity'],
            'mode' => $scale['mode'] ?? null,
        ];
    }

    public function test_the_committed_labels_are_still_read_the_way_the_server_reads_them(): void
    {
        $weight = ['scale_barcode_enabled' => true, 'scale_barcode_prefix' => '2', 'scale_barcode_mode' => 'weight'];
        $price = ['scale_barcode_enabled' => true, 'scale_barcode_prefix' => '2', 'scale_barcode_mode' => 'price'];
        $twoDigit = ['scale_barcode_enabled' => true, 'scale_barcode_prefix' => '21', 'scale_barcode_mode' => 'weight'];
        $off = ['scale_barcode_enabled' => false, 'scale_barcode_prefix' => '2', 'scale_barcode_mode' => 'weight'];

        $cases = [
            ['a kilo and a half of sugar', $weight, '2000021015000'],
            ['a weight that is not a round number', $weight, '2000021003470'],
            ['a PLU stored with its zeroes still finds its item', $weight, '2000305020009'],
            ['the scale printed the PRICE, and the weight is worked back from it', $price, '2000021027000'],
            ['a price label on an item that is on sale', $price, '2000077018004'],
            ['a two-digit prefix leaves a shorter PLU', $twoDigit, '2104410002505'],
            ['a label for something this shop does not stock', $weight, '2009999010006'],
            ['a label with the switch off is just a number', $off, '2000021015000'],
            ['twelve digits is not a label', $weight, '200002101500'],
            ['the wrong first digit is not a label', $weight, '3000021015000'],
        ];

        $fixtures = [
            'version' => self::VERSION,
            'note' => 'Generated by ScaleLabelFixturesTest with SHOPOS_WRITE_FIXTURES=1. Do not hand-edit.',
            'shelf' => $this->shelf(),
            'labels' => array_map(fn (array $c) => [
                'name' => $c[0], 'settings' => $c[1], 'code' => $c[2], 'expected' => $this->ask($c[1], $c[2]),
            ], $cases),
        ];

        // THE DENOMINATOR: both kinds of answer are in here, or the file proves half.
        $found = array_filter($fixtures['labels'], fn (array $l) => $l['expected']['found']);
        $this->assertGreaterThanOrEqual(6, count($found), 'too few labels resolve to an item');
        $this->assertGreaterThanOrEqual(4, count($fixtures['labels']) - count($found), 'too few labels are refused');

        $path = base_path('tests/fixtures/scale-labels.json');

        if (env('SHOPOS_WRITE_FIXTURES') === '1') {
            file_put_contents($path, json_encode($fixtures, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)."\n");
            $this->markTestSkipped('Fixtures rewritten. Read the diff, then copy to the panel.');
        }

        $this->assertFileExists($path, 'Run with SHOPOS_WRITE_FIXTURES=1 to create the fixtures.');
        $this->assertEquals(
            $fixtures,
            json_decode((string) file_get_contents($path), true),
            "The server no longer reads these labels the way the fixtures say.\n\n"
            ."The till offline is still reading them the OLD way. Regenerate and copy:\n\n"
            ."    SHOPOS_WRITE_FIXTURES=1 php artisan test --filter=ScaleLabelFixturesTest\n"
            ."    cp tests/fixtures/scale-labels.json ../panel/src/modules/offline/lookup/fixtures/\n",
        );
    }
}
