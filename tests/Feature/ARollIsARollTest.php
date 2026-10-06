<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\HardwareDevice;
use App\Models\Product;
use App\Models\Register;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\PrintPaper;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\File;
use Tests\TestCase;

/**
 * A RECEIPT SET TO A ROLL PRINTS ON A ROLL.
 *
 *     "Receipt main thermal 80mm select hai to POS screen main print wo size
 *      ni niklta, A4 size e hota hai."
 *
 * Every roll template wrote `@page { size: 80mm auto }`. A page's size is one
 * length, two lengths, or a named sheet — "a length and auto" is not CSS, so
 * Chrome and Safari drop it and print on the default sheet. The receipt test
 * that existed asserted the page contained the string `size: 58mm auto`, so
 * it was green for as long as the bug was there.
 *
 * These ask the question a browser asks: is this a size I can use?
 */
class ARollIsARollTest extends TestCase
{
    use RefreshDatabase;

    /** What CSS allows after `size:` for a page — and nothing else. */
    private const VALID_SIZE = '/^(A4|A5|letter|legal|\d+(\.\d+)?(mm|cm|in)( \d+(\.\d+)?(mm|cm|in))?)$/i';

    private Tenant $tenant;

    private User $owner;

    private Register $lane;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $main = Branch::withoutTenancy()->where('tenant_id', $this->tenant->id)->where('is_default', true)->firstOrFail();
        $this->lane = Register::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $main->id, 'name' => 'Lane 1', 'is_active' => true,
        ]);
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Basmati Rice', 'price' => 950, 'stock_quantity' => 100, 'track_inventory' => true,
        ]);
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token)->withHeader('X-Register-Id', $this->lane->id);
    }

    /** The receipt for a fresh sale, as the till is handed it. */
    private function receipt(): string
    {
        $sale = $this->as()->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1000,
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        return (string) $this->as()->get("/api/v1/sales/{$sale['id']}/invoice")->assertOk()->getContent();
    }

    /** Every `size` a document asks its page to be. */
    private function pageSizes(string $html): array
    {
        preg_match_all('/@page\s*\{[^}]*\}/', $html, $rules);
        $sizes = [];
        foreach ($rules[0] as $rule) {
            if (preg_match('/size\s*:\s*([^;}]+)/', $rule, $m)) {
                $sizes[] = trim($m[1]);
            }
        }

        return $sizes;
    }

    public function test_a_receipt_set_to_80mm_asks_for_an_80mm_page_a_browser_will_accept(): void
    {
        $this->tenant->update(['settings' => ['receipt_width' => 'thermal_80']]);

        $html = $this->receipt();
        $sizes = $this->pageSizes($html);

        // THE DENOMINATOR: there is a page rule, and it does name a size.
        $this->assertNotSame([], $sizes, 'the receipt names no page size at all');
        foreach ($sizes as $size) {
            $this->assertMatchesRegularExpression(self::VALID_SIZE, $size, "`size: {$size}` is not CSS — a browser drops it and prints A4");
            $this->assertStringStartsWith('80mm', $size);
        }
        // …and tells whatever prints it which roll to fit the page to.
        $this->assertStringContainsString('<html lang="en" data-roll-mm="80" data-roll-margin-mm="3">', $html);
    }

    public function test_a_58mm_roll_is_58mm(): void
    {
        $this->tenant->update(['settings' => ['receipt_width' => 'thermal_58']]);

        $html = $this->receipt();

        $this->assertSame(['58mm 297mm'], $this->pageSizes($html));
        $this->assertStringContainsString('data-roll-mm="58"', $html);
    }

    public function test_a_sheet_is_a4_and_is_not_fitted_like_a_roll(): void
    {
        $this->tenant->update(['settings' => ['receipt_width' => 'standard']]);

        $html = $this->receipt();

        $this->assertSame(['A4'], $this->pageSizes($html));
        $this->assertStringNotContainsString('data-roll-mm', $html);
    }

    public function test_the_lanes_own_printer_decides_over_the_shops_default(): void
    {
        // The shop issues A4 invoices; this lane has an 80mm thermal on it.
        $this->tenant->update(['settings' => ['receipt_width' => 'standard']]);
        HardwareDevice::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'register_id' => $this->lane->id, 'type' => 'receipt_printer',
            'name' => 'Lane 1 printer', 'connection_type' => 'usb', 'is_active' => true, 'is_default' => true,
            'settings' => ['paper_size' => '80mm'],
        ]);

        $html = $this->receipt();

        $this->assertSame(['80mm 297mm'], $this->pageSizes($html));
        $this->assertStringContainsString('data-roll-mm="80"', $html);
    }

    public function test_no_template_sizes_its_page_by_hand(): void
    {
        /*
         * Four templates each had their own copy of the roll's size, and all
         * four were wrong in the same way (the kitchen ticket named none).
         * The size comes from PrintPaper or it does not get written.
         */
        $pages = 0;
        $byHand = [];
        foreach (File::allFiles(resource_path('views')) as $file) {
            foreach (explode("\n", $file->getContents()) as $n => $line) {
                if (! str_contains($line, '@page')) {
                    continue;
                }
                $pages++;
                if (! str_contains($line, 'PrintPaper::pageSize(')) {
                    $byHand[] = $file->getRelativePathname().':'.($n + 1);
                }
            }
        }

        // The four that print: receipt, Z-read, quote/advance, kitchen ticket.
        $this->assertGreaterThanOrEqual(4, $pages, 'the scan found fewer printable templates than exist');
        $this->assertSame([], $byHand, 'a template sets its own @page instead of asking PrintPaper');
    }

    public function test_every_size_it_hands_out_is_one_a_browser_accepts(): void
    {
        foreach (['thermal_58', 'thermal_80', 'standard', null, 'something-new'] as $width) {
            $this->assertMatchesRegularExpression(self::VALID_SIZE, PrintPaper::pageSize($width));
        }
        // An unknown paper is a sheet, never a guess at a roll.
        $this->assertSame('A4', PrintPaper::pageSize('something-new'));
        $this->assertSame('', PrintPaper::htmlAttributes('something-new', 3));
        $this->assertNull(PrintPaper::rollMm(null));
    }
}
